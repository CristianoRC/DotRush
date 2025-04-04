import { ConfigurationItem, Project } from '../models/project';
import { StateController } from './stateController';
import { PublicExports } from '../publicExports';
import { Interop } from "../interop/interop";
import { Extensions } from '../extensions';
import { Icons } from '../resources/icons';
import * as res from '../resources/constants';
import * as vscode from 'vscode';
import * as path from 'path';

export class StatusBarController {
    private static configurationStatusBarItem: vscode.StatusBarItem;
    private static projectDecorationProvider: StartupProjectDecorationProvider;

    public static activeProject: Project | undefined;
    public static activeConfiguration: string | undefined;
    public static activeFramework: string | undefined;

    public static async activate(context: vscode.ExtensionContext): Promise<void> {
        StatusBarController.configurationStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        StatusBarController.projectDecorationProvider = new StartupProjectDecorationProvider();
        StatusBarController.configurationStatusBarItem.command = res.commandIdSelectActiveConfiguration;

        context.subscriptions.push(StatusBarController.configurationStatusBarItem);
        context.subscriptions.push(vscode.window.registerFileDecorationProvider(StatusBarController.projectDecorationProvider));
        context.subscriptions.push(vscode.commands.registerCommand(res.commandIdSelectActiveConfiguration, StatusBarController.showQuickPickConfiguration));
        context.subscriptions.push(vscode.commands.registerCommand(res.commandIdActiveProjectPath, () => StatusBarController.activeProject?.path));
        context.subscriptions.push(vscode.commands.registerCommand(res.commandIdActiveConfiguration, () => StatusBarController.activeConfiguration));
        context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async e => {
            if (path.extname(e.fileName) === '.csproj' && StatusBarController.activeProject !== undefined)
                StatusBarController.updateStatusBarState(StatusBarController.activeProject.path);
        }));

        await vscode.commands.executeCommand('setContext', res.commandIdStatusBarEnabled, true);
        await StatusBarController.updateStatusBarState(undefined);
    }

    public static async updateStatusBarState(projectPath: string | undefined): Promise<void> {
        if (projectPath === undefined) {
            const projects = await Extensions.getProjectFiles();
            if (projects.length <= 0)
                return StatusBarController.configurationStatusBarItem.hide();

            projectPath = StateController.getLocal<string>('project');
            if (projectPath === undefined || !projects.includes(projectPath))
                projectPath = projects[0];
        }

        const project = await Interop.getProject(projectPath);
        StatusBarController.activeProject = project;
        StatusBarController.projectDecorationProvider.update(project);
        PublicExports.instance.onActiveProjectChanged.invoke(StatusBarController.activeProject);
        StateController.putLocal('project', StatusBarController.activeProject.path);

        const configuration = StateController.getLocal<string>('configuration');
        const framework = StateController.getLocal<string>('framework');
        const activeConfiguration = StatusBarController.activeProject.configurations.find(it => it === configuration);
        const activeFramework = StatusBarController.activeProject.frameworks.find(it => it === framework);
        StatusBarController.performSelectConfiguration(activeConfiguration, activeFramework);
        StatusBarController.configurationStatusBarItem.show();
    }

    private static performSelectConfiguration(config: string | undefined, framework: string | undefined) {
        StatusBarController.activeConfiguration = config;
        StatusBarController.activeFramework = framework;

        if (StatusBarController.activeFramework === undefined)
            StatusBarController.configurationStatusBarItem.text = `${Icons.target} ${StatusBarController.activeConfiguration}`;
        else
            StatusBarController.configurationStatusBarItem.text = `${Icons.target} ${StatusBarController.activeConfiguration} | ${StatusBarController.activeFramework}`;

        PublicExports.instance.onActiveConfigurationChanged.invoke(StatusBarController.activeConfiguration);
        PublicExports.instance.onActiveFrameworkChanged.invoke(StatusBarController.activeFramework);
        StateController.putLocal('configuration', StatusBarController.activeConfiguration);
        StateController.putLocal('framework', StatusBarController.activeFramework);
    }
    private static async showQuickPickConfiguration(): Promise<void> {
        const configurations = StatusBarController.activeProject?.configurations ?? [];
        const frameworks = StatusBarController.activeProject?.frameworks ?? [];
        if (configurations.length <= 0)
            return;

        const items = [];
        for (const config of configurations) {
            if (frameworks.length <= 0) {
                items.push(new ConfigurationItem(config, undefined));
                continue;
            }
            for (const framework of frameworks)
                items.push(new ConfigurationItem(config, framework));
        }

        const options = { placeHolder: `${StatusBarController.activeProject?.name}: ${res.commandTitleSelectActiveConfiguration}`, matchOnDescription: true };
        const selectedItem = await vscode.window.showQuickPick(items, options);
        if (selectedItem !== undefined)
            StatusBarController.performSelectConfiguration(selectedItem.configuration, selectedItem.framework);
    }
}

class StartupProjectDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    private startupProjectUri: vscode.Uri | undefined;

    public onDidChangeFileDecorations?: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> | undefined = this._onDidChangeFileDecorations.event;
    public provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
        if (this.startupProjectUri === undefined)
            return undefined;
        if (this.startupProjectUri.fsPath !== uri.fsPath && !this.startupProjectUri.fsPath.startsWith(`${uri.fsPath}${path.sep}`))
            return undefined;

        return {
            badge: '●',
            color: new vscode.ThemeColor('pickerGroup.foreground'),
            tooltip: 'Startup Project'
        };
    }

    public update(project: Project | undefined) {
        if (project === undefined) {
            this.startupProjectUri = undefined;
            this._onDidChangeFileDecorations.fire(undefined);
            return;
        }

        this.startupProjectUri = vscode.Uri.file(project.path);
        this._onDidChangeFileDecorations.fire(undefined);
    }
}