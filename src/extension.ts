import * as vscode from 'vscode';

// -----------------------------------------------------------------------------
// 常量定义
// -----------------------------------------------------------------------------

// 内置函数
import BUILTINS from './builtins.json';

// 语义高亮图例
const tokenTypes = ['function', 'parameter', 'variable'];
const tokenModifiers = ['declaration'];
const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

// -----------------------------------------------------------------------------
// 辅助解析
// -----------------------------------------------------------------------------

// 用于存储解析出的函数信息
interface JQFunction {
    name: string;
    valueArgs: string[];
    filterArgs: string[];
    startLine: number;
    endLine: number;
}

// 文档解析器
class JQParser {
    static parse(text: string): JQFunction[] {
        const functions: JQFunction[] = [];
        const lines = text.split(/\r?\n/);

        // 第一遍：收集所有定义，记录行号、缩进、参数
        const defRegex = /^(\s*)def\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\(([^)]*)\))?\s*:/;
        const defs: Array<{
            name: string;
            valueArgs: string[];
            filterArgs: string[];
            startLine: number;
            indent: number;
        }> = [];

        for (let i = 0; i < lines.length; i++) {
            const match = defRegex.exec(lines[i]);
            if (match) {
                const indent = match[1].length;
                const funcName = match[2];
                const rawArgsStr = match[3] || '';

                // 分离值参数和过滤器参数
                const args = rawArgsStr.split(';').map(s => s.trim()).filter(s => s);
                const valueArgs = args.filter(a => a.startsWith('$'));
                const filterArgs = args.filter(a => !a.startsWith('$'));

                defs.push({
                    name: funcName,
                    valueArgs,
                    filterArgs,
                    startLine: i,
                    indent
                });
            }
        }

        // 第二遍：根据缩进确定每个函数的结束行
        for (let i = 0; i < defs.length; i++) {
            const currentDef = defs[i];
            let endLine = lines.length - 1;

            // 查找函数体结束
            for (let j = currentDef.startLine + 1; j < lines.length; j++) {
                const line = lines[j].trim();
                // 跳过空行和注释行
                if (line === '' || line.startsWith('#')) {
                    continue;
                }
                // 检查缩进
                const lineIndent = lines[j].length - lines[j].trimStart().length;
                if (lineIndent <= currentDef.indent) {
                    endLine = j - 1;
                    break;
                }
            }

            functions.push({
                name: currentDef.name,
                valueArgs: currentDef.valueArgs,
                filterArgs: currentDef.filterArgs,
                startLine: currentDef.startLine,
                endLine
            });
        }

        return functions;
    }

    // 判断是否在注释内
    static isInComment(text: string, offset: number): boolean {
        // 查找最近的换行符
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
        const line = text.substring(lineStart, text.indexOf('\n', lineStart + 1) === -1 ? text.length : text.indexOf('\n', lineStart + 1));
        return /^\s*#/.test(line);
    }
}

// -----------------------------------------------------------------------------
// 语义高亮
// -----------------------------------------------------------------------------

// 设置全局参数映射
class JQSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
        const tokensBuilder = new vscode.SemanticTokensBuilder(legend);
        const text = document.getText();
        const userFunctions = JQParser.parse(text);
        const userFuncNames = new Set(userFunctions.map(f => f.name));

        // 构建参数映射
        const allParams = new Set<string>();
        userFunctions.forEach(f => {
            f.valueArgs.forEach(arg => {
                const name = arg.startsWith('$') ? arg.substring(1) : arg;
                allParams.add(name);
            });
            f.filterArgs.forEach(arg => {
                allParams.add(arg);
            });
        });

        // 构建函数上下文映射
        const getContextFunction = (line: number): JQFunction | undefined => {
            return userFunctions.find(f => line >= f.startLine && line <= f.endLine);
        };

        // 词法分析
        const tokenRegex = /([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;

        while ((match = tokenRegex.exec(text)) !== null) {
            const word = match[0];
            const offset = match.index;
            const position = document.positionAt(offset);

            // 跳过注释区域
            if (JQParser.isInComment(text, offset)) { continue; }

            // 检查当前位置是否在某个函数定义行
            const contextFunc = getContextFunction(position.line);

            // 优先级1：检查是否是当前函数的参数
            if (contextFunc) {
                const isValueParam = contextFunc.valueArgs.some(arg => {
                    const paramName = arg.startsWith('$') ? arg.substring(1) : arg;
                    return paramName === word;
                });
                const isFilterParam = contextFunc.filterArgs.some(arg => arg === word);

                if (isValueParam || isFilterParam) {
                    tokensBuilder.push(
                        new vscode.Range(position, position.translate(0, word.length)),
                        'parameter'
                    );
                    continue;
                }
            }

            // 优先级2：用户自定义函数高亮
            if (userFuncNames.has(word)) {
                tokensBuilder.push(
                    new vscode.Range(position, position.translate(0, word.length)),
                    'function'
                );
                continue;
            }

            // 优先级3：内置函数高亮
            if (BUILTINS.includes(word) && !allParams.has(word)) {
                tokensBuilder.push(
                    new vscode.Range(position, position.translate(0, word.length)),
                    'function'
                );
            }
        }

        return tokensBuilder.build();
    }
}

// -----------------------------------------------------------------------------
// 自动补全
// -----------------------------------------------------------------------------

class JQCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        const completions: vscode.CompletionItem[] = [];
        const text = document.getText();
        const functions = JQParser.parse(text);

        // 判断光标是否在函数定义内部
        const currentFunc = functions.find(f => position.line >= f.startLine && position.line <= f.endLine);

        // 参数补全
        if (currentFunc) {
            // 值参数补全
            currentFunc.valueArgs.forEach(arg => {
                // 统一格式化为 $name
                const fullVarName = arg.startsWith('$') ? arg : '$' + arg;
                const paramName = arg.startsWith('$') ? arg.substring(1) : arg;

                const item = new vscode.CompletionItem(fullVarName, vscode.CompletionItemKind.Variable);
                item.detail = `Value parameter of ${currentFunc.name}`;
                item.sortText = "0000";

                // 判断是否已输入 '$'
                const range = new vscode.Range(position.translate(0, -1), position);
                const charBeforeCursor = position.character > 0 ? document.getText(range) : '';
                const isTriggeredByDollar = charBeforeCursor === '$';

                // 若已输入则补全中去除 '$'
                if (isTriggeredByDollar) {
                    item.insertText = paramName;
                    item.filterText = paramName;
                } else {
                    item.insertText = fullVarName;
                }

                completions.push(item);
            });

            // 过滤器参数补全
            currentFunc.filterArgs.forEach(arg => {
                const item = new vscode.CompletionItem(arg, vscode.CompletionItemKind.Variable);
                item.detail = `Filter parameter of ${currentFunc.name}`;
                item.sortText = "0001";
                item.insertText = arg;

                completions.push(item);
            });
        }

        // 用户定义函数补全
        functions.forEach(f => {
            // 避免递归提示
            if (f.name !== currentFunc?.name) {
                const item = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Function);
                item.detail = `User defined function`;

                // 自动补全参数
                const allArgs = [...f.valueArgs, ...f.filterArgs];
                if (allArgs.length > 0) {
                    const argsSnippet = allArgs.map((arg, idx) => {
                        const paramName = arg.startsWith('$') ? arg.substring(1) : arg;
                        return `\${${idx + 1}:${paramName}}`;
                    }).join('; ');
                    item.insertText = new vscode.SnippetString(`${f.name}(${argsSnippet})`);
                } else {
                    item.insertText = f.name;
                }
                completions.push(item);
            }
        });

        // 提供内置函数
        BUILTINS.forEach(b => {
            completions.push(new vscode.CompletionItem(b, vscode.CompletionItemKind.Function));
        });

        return completions;
    }
}

// -----------------------------------------------------------------------------
// 激活函数
// -----------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    // 注册语义高亮
    context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(
        { language: 'jq' },
        new JQSemanticTokensProvider(),
        legend
    ));

    // 注册自动补全
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
        'jq',
        new JQCompletionItemProvider(),
        '$' // 触发字符
    ));
}

export function deactivate() { }