/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
var vscode_languageserver_1 = require('vscode-languageserver');
var fs = require('fs');
var path = require('path');
function makeDiagnostic(problem) {
    return {
        message: problem.reason,
        severity: getSeverity(problem),
        code: problem.code,
        range: {
            start: { line: problem.line - 1, character: problem.character - 1 },
            end: { line: problem.line - 1, character: problem.character - 1 }
        }
    };
}
function getSeverity(problem) {
    if (problem.id === '(error)') {
        return vscode_languageserver_1.DiagnosticSeverity.Error;
    }
    return vscode_languageserver_1.DiagnosticSeverity.Warning;
}
var JSHINTRC = '.jshintrc';
var OptionsResolver = (function () {
    function OptionsResolver(connection) {
        this.connection = connection;
        this.clear();
        this.jshintOptions = null;
    }
    OptionsResolver.prototype.clear = function (jshintOptions) {
        this.optionsCache = Object.create(null);
        if (jshintOptions) {
            this.jshintOptions = jshintOptions;
        }
    };
    OptionsResolver.prototype.getOptions = function (fsPath) {
        var result = this.optionsCache[fsPath];
        if (!result) {
            result = this.readOptions(fsPath);
            this.optionsCache[fsPath] = result;
        }
        return result;
    };
    OptionsResolver.prototype.readOptions = function (fsPath) {
        if (fsPath === void 0) { fsPath = null; }
        var that = this;
        function locateFile(directory, fileName) {
            var parent = directory;
            do {
                directory = parent;
                var location_1 = path.join(directory, fileName);
                if (fs.existsSync(location_1)) {
                    return location_1;
                }
                parent = path.dirname(directory);
            } while (parent !== directory);
            return undefined;
        }
        ;
        function stripComments(content) {
            /**
            * First capturing group mathes double quoted string
            * Second matches singler quotes string
            * Thrid matches block comments
            * Fourth matches line comments
            */
            var regexp = /("(?:[^\\\"]*(?:\\.)?)*")|('(?:[^\\\']*(?:\\.)?)*')|(\/\*(?:\r?\n|.)*?\*\/)|(\/{2,}.*?(?:(?:\r?\n)|$))/g;
            var result = content.replace(regexp, function (match, m1, m2, m3, m4) {
                // Only one of m1, m2, m3, m4 matches
                if (m3) {
                    // A block comment. Replace with nothing
                    return "";
                }
                else if (m4) {
                    // A line comment. If it ends in \r?\n then keep it.
                    var length_1 = m4.length;
                    if (length_1 > 2 && m4[length_1 - 1] === '\n') {
                        return m4[length_1 - 2] === '\r' ? '\r\n' : '\n';
                    }
                    else {
                        return "";
                    }
                }
                else {
                    // We match a string
                    return match;
                }
            });
            return result;
        }
        ;
        function readJsonFile(file) {
            try {
                return JSON.parse(stripComments(fs.readFileSync(file).toString()));
            }
            catch (err) {
                that.connection.window.showErrorMessage("Can't load JSHint configuration from file " + file + ". Please check the file for syntax errors.");
                return {};
            }
        }
        function isWindows() {
            return process.platform === 'win32';
        }
        function getUserHome() {
            return process.env[isWindows() ? 'USERPROFILE' : 'HOME'];
        }
        var jshintOptions = this.jshintOptions;
        if (jshintOptions && jshintOptions.config && fs.existsSync(jshintOptions.config)) {
            return readJsonFile(jshintOptions.config);
        }
        if (fsPath) {
            var packageFile = locateFile(fsPath, 'package.json');
            if (packageFile) {
                var content = readJsonFile(packageFile);
                if (content.jshintConfig) {
                    return content.jshintConfig;
                }
            }
            var configFile = locateFile(fsPath, JSHINTRC);
            if (configFile) {
                return readJsonFile(configFile);
            }
        }
        var home = getUserHome();
        if (home) {
            var file = path.join(home, JSHINTRC);
            if (fs.existsSync(file)) {
                return readJsonFile(file);
            }
        }
        return jshintOptions;
    };
    return OptionsResolver;
})();
var Linter = (function () {
    function Linter() {
        var _this = this;
        this.connection = vscode_languageserver_1.createConnection(new vscode_languageserver_1.IPCMessageReader(process), new vscode_languageserver_1.IPCMessageWriter(process));
        this.options = new OptionsResolver(this.connection);
        this.documents = new vscode_languageserver_1.TextDocuments();
        this.documents.onDidChangeContent(function (event) { return _this.validateSingle(event.document); });
        this.documents.listen(this.connection);
        this.connection.onInitialize(function (params) { return _this.onInitialize(params); });
        this.connection.onDidChangeConfiguration(function (params) {
            var jshintOptions = params.settings.jshint ? params.settings.jshint.options : {};
            _this.options.clear(jshintOptions);
            _this.validateAll();
        });
        this.connection.onDidChangeWatchedFiles(function (params) {
            _this.options.clear();
            _this.validateAll();
        });
    }
    Linter.prototype.listen = function () {
        this.connection.listen();
    };
    Linter.prototype.onInitialize = function (params) {
        var _this = this;
        this.workspaceRoot = params.rootPath;
        return vscode_languageserver_1.Files.resolveModule(this.workspaceRoot, 'jshint').then(function (value) {
            if (!value.JSHINT) {
                return new vscode_languageserver_1.ResponseError(99, 'The jshint library doesn\'t export a JSHINT property.', { retry: false });
            }
            _this.lib = value;
            var result = { capabilities: { textDocumentSync: _this.documents.syncKind } };
            return result;
        }, function (error) {
            return Promise.reject(new vscode_languageserver_1.ResponseError(99, 'Failed to load jshint library. Please install jshint in your workspace folder using \'npm install jshint\' or globally using \'npm install -g jshint\' and then press Retry.', { retry: true }));
        });
    };
    Linter.prototype.validateAll = function () {
        var _this = this;
        var tracker = new vscode_languageserver_1.ErrorMessageTracker();
        this.documents.all().forEach(function (document) {
            try {
                _this.validate(document);
            }
            catch (err) {
                tracker.add(_this.getMessage(err, document));
            }
        });
        tracker.sendErrors(this.connection);
    };
    Linter.prototype.validateSingle = function (document) {
        try {
            this.validate(document);
        }
        catch (err) {
            this.connection.window.showErrorMessage(this.getMessage(err, document));
        }
    };
    Linter.prototype.validate = function (document) {
        var content = document.getText();
        var JSHINT = this.lib.JSHINT;
        var fsPath = vscode_languageserver_1.Files.uriToFilePath(document.uri);
        if (!fsPath) {
            fsPath = this.workspaceRoot;
        }
        var options = this.options.getOptions(fsPath) || {};
        JSHINT(content, options, options.globals || {});
        var diagnostics = [];
        var errors = JSHINT.errors;
        if (errors) {
            errors.forEach(function (error) {
                // For some reason the errors array contains null.
                if (error) {
                    diagnostics.push(makeDiagnostic(error));
                }
            });
        }
        this.connection.sendDiagnostics({ uri: document.uri, diagnostics: diagnostics });
    };
    Linter.prototype.getMessage = function (err, document) {
        var result = null;
        if (typeof err.message === 'string' || err.message instanceof String) {
            result = err.message;
        }
        else {
            result = "An unknown error occured while validating file: " + vscode_languageserver_1.Files.uriToFilePath(document.uri);
        }
        return result;
    };
    return Linter;
})();
new Linter().listen();
//# sourceMappingURL=server.js.map