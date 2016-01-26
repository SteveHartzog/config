var editorconfig = require('editorconfig');
var fs = require('fs');
var vscode_1 = require('vscode');
function activate(ctx) {
    var documentWatcher = new DocumentWatcher();
    ctx.subscriptions.push(documentWatcher);
    ctx.subscriptions.push(vscode_1.window.onDidChangeActiveTextEditor(function (textEditor) {
        applyEditorConfigToTextEditor(textEditor, documentWatcher);
    }));
    applyEditorConfigToTextEditor(vscode_1.window.activeTextEditor, documentWatcher);
    // register a command handler to generate a .editorconfig file
    vscode_1.commands.registerCommand('vscode.generateeditorconfig', generateEditorConfig);
}
exports.activate = activate;
/**
 * Listens to vscode document open and maintains a map (Document => editor config settings)
 */
var DocumentWatcher = (function () {
    function DocumentWatcher() {
        var _this = this;
        var subscriptions = [];
        // Listen for new documents being openend
        subscriptions.push(vscode_1.workspace.onDidOpenTextDocument(function (doc) { return _this._onDidOpenDocument(doc); }));
        // Listen for saves to ".editorconfig" files and rebuild the map
        subscriptions.push(vscode_1.workspace.onDidSaveTextDocument(function (savedDocument) {
            if (/\.editorconfig$/.test(savedDocument.fileName)) {
                // Saved an .editorconfig file => rebuild map entirely
                _this._rebuildConfigMap();
            }
            applyOnSaveTransformations(savedDocument, _this);
        }));
        // dispose event subscriptons upon disposal
        this._disposable = vscode_1.Disposable.from.apply(vscode_1.Disposable, subscriptions);
        // Build the map (cover the case that documents were opened before my activation)
        this._rebuildConfigMap();
    }
    DocumentWatcher.prototype.dispose = function () {
        this._disposable.dispose();
    };
    DocumentWatcher.prototype.getSettingsForDocument = function (document) {
        return this._documentToConfigMap[document.fileName];
    };
    DocumentWatcher.prototype._rebuildConfigMap = function () {
        var _this = this;
        this._documentToConfigMap = {};
        vscode_1.workspace.textDocuments.forEach(function (document) { return _this._onDidOpenDocument(document); });
    };
    DocumentWatcher.prototype._onDidOpenDocument = function (document) {
        var _this = this;
        if (document.isUntitled) {
            // Does not have a fs path
            return;
        }
        var path = document.fileName;
        editorconfig.parse(path).then(function (config) {
            // workaround for the fact that sometimes indent_size is set to "tab":
            // see https://github.com/editorconfig/editorconfig-core-js/blob/b2e00d96fcf3be242d4bf748829b8e3a778fd6e2/editorconfig.js#L56
            if (config.indent_size === 'tab') {
                delete config.indent_size;
            }
            // console.log('storing ' + path + ' to ' + JSON.stringify(config, null, '\t'));
            _this._documentToConfigMap[path] = config;
            applyEditorConfigToTextEditor(vscode_1.window.activeTextEditor, _this);
        });
    };
    return DocumentWatcher;
})();
function applyEditorConfigToTextEditor(textEditor, provider) {
    if (!textEditor) {
        // No more open editors
        return;
    }
    var doc = textEditor.document;
    var editorconfig = provider.getSettingsForDocument(doc);
    if (!editorconfig) {
        // no configuration found for this file
        return;
    }
    var _a = textEditor.options, insertSpaces = _a.insertSpaces, tabSize = _a.tabSize;
    var newOptions = Utils.fromEditorConfig(editorconfig, {
        insertSpaces: insertSpaces,
        tabSize: tabSize
    });
    // console.log('setting ' + textEditor.document.fileName + ' to ' + JSON.stringify(newOptions, null, '\t'));
    vscode_1.window.setStatusBarMessage('EditorConfig: ' + (newOptions.insertSpaces ? "Spaces:" : "Tabs:") + ' ' + newOptions.tabSize, 1500);
    textEditor.options = newOptions;
}
function applyOnSaveTransformations(textDocument, provider) {
    var editorconfig = provider.getSettingsForDocument(textDocument);
    if (!editorconfig) {
        // no configuration found for this file
        return;
    }
    insertFinalNewlineTransform(editorconfig, textDocument);
}
function insertFinalNewlineTransform(editorconfig, textDocument) {
    if (editorconfig.insert_final_newline && textDocument.lineCount > 0) {
        var lastLine = textDocument.lineAt(textDocument.lineCount - 1);
        var lastLineLength = lastLine.text.length;
        if (lastLineLength < 1) {
            return;
        }
        var editor = findEditor(textDocument);
        if (!editor) {
            return;
        }
        editor.edit(function (edit) {
            var pos = new vscode_1.Position(lastLine.lineNumber, lastLineLength);
            return edit.insert(pos, newline(editorconfig));
        }).then(function () { return textDocument.save(); });
    }
}
function newline(editorconfig) {
    if (editorconfig.end_of_line === 'cr') {
        return '\r';
    }
    else if (editorconfig.end_of_line == 'crlf') {
        return '\r\n';
    }
    return '\n';
}
function findEditor(textDocument) {
    for (var _i = 0, _a = vscode_1.window.visibleTextEditors; _i < _a.length; _i++) {
        var editor = _a[_i];
        if (editor.document === textDocument) {
            return editor;
        }
    }
    return null;
}
/**
 * Generate an .editorconfig file in the root of the workspace based on the current vscode settings.
 */
function generateEditorConfig() {
    if (!vscode_1.workspace.rootPath) {
        vscode_1.window.showInformationMessage("Please open a folder before generating an .editorconfig file");
        return;
    }
    var editorConfigurationNode = vscode_1.workspace.getConfiguration('editor');
    var settings = Utils.toEditorConfig({
        insertSpaces: editorConfigurationNode.get('insertSpaces'),
        tabSize: editorConfigurationNode.get('tabSize')
    });
    var fileContents = "root = true\n\n[*]\n";
    [
        'indent_style',
        'indent_size',
        'tab_width'
    ].forEach(function (setting) {
        if (settings.hasOwnProperty(setting)) {
            fileContents += setting + " = " + settings[setting] + "\n";
        }
    });
    var editorconfigFile = vscode_1.workspace.rootPath + '/.editorconfig';
    fs.exists(editorconfigFile, function (exists) {
        if (exists) {
            vscode_1.window.showInformationMessage('An .editorconfig file already exists in your workspace.');
            return;
        }
        fs.writeFile(editorconfigFile, fileContents, function (err) {
            if (err) {
                vscode_1.window.showErrorMessage(err.toString());
                return;
            }
        });
    });
}
var Utils = (function () {
    function Utils() {
    }
    /**
     * Convert .editorconfig values to vscode editor options
     */
    Utils.fromEditorConfig = function (config, defaults) {
        return {
            insertSpaces: config.indent_style ? (config.indent_style === 'tab' ? false : true) : defaults.insertSpaces,
            tabSize: config.tab_width || config.indent_size || defaults.tabSize
        };
    };
    /**
     * Convert vscode editor options to .editorconfig values
     */
    Utils.toEditorConfig = function (options) {
        var result = {};
        switch (options.insertSpaces) {
            case true:
                result.indent_style = 'space';
                result.indent_size = Utils.resolveTabSize(options.tabSize);
                break;
            case false:
            case 'auto':
                result.indent_style = 'tab';
                result.tab_width = Utils.resolveTabSize(options.tabSize);
                break;
        }
        return result;
    };
    /**
     * Convert vscode tabSize option into numeric value
     */
    Utils.resolveTabSize = function (tabSize) {
        return (tabSize === 'auto') ? 4 : parseInt(tabSize + '', 10);
    };
    return Utils;
})();
exports.Utils = Utils;
//# sourceMappingURL=editorConfigMain.js.map