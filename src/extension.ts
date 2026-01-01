import * as vscode from 'vscode';

// -----------------------------------------------------------------------------
// 常量定义
// -----------------------------------------------------------------------------
const BUILTINS = [
	'length', 'keys', 'map', 'select', 'has', 'contains', 'unique', 'sort',
	'group_by', 'to_entries', 'from_entries', 'split', 'join', 'tostring',
	'tonumber', 'range', 'limit', 'isempty', 'error', 'empty', 'debug',
	'type', 'del', 'walk', 'transpose', 'all', 'any'
];

const KEYWORDS = ['def', 'if', 'then', 'else', 'elif', 'end'];

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
	args: string[];
	startLine: number;
	endLine: number; // 作用域判断
}

// 文档解析器
class JQParser {
	static parse(text: string): JQFunction[] {
		const functions: JQFunction[] = [];
		const lines = text.split(/\r?\n/);

		// 函数定义
		// def \s+ (名字) (?: \( (参数) \) )? :
		const defRegex = /def\s+([a-zA-Z0-9_]+)(?:\(([^)]+)\))?\s*:/;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const match = defRegex.exec(line);

			if (match) {
				const funcName = match[1];
				const rawArgs = match[2] ? match[2].split(';').map(s => s.trim()) : [];

				// 计算结束行
				let endLine = lines.length - 1;
				for (let j = i + 1; j < lines.length; j++) {
					if (/^\s*def\s+/.test(lines[j])) {
						endLine = j - 1;
						break;
					}
				}

				functions.push({
					name: funcName,
					args: rawArgs,
					startLine: i,
					endLine: endLine
				});
			}
		}
		return functions;
	}
}

// -----------------------------------------------------------------------------
// 语义高亮
// -----------------------------------------------------------------------------
class JQSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
		const tokensBuilder = new vscode.SemanticTokensBuilder(legend);
		const text = document.getText();
		const userFunctions = JQParser.parse(text);
		const userFuncNames = new Set(userFunctions.map(f => f.name));

		// 词法分析
		const tokenRegex = /([a-zA-Z_][a-zA-Z0-9_]*)/g;
		let match;

		while ((match = tokenRegex.exec(text)) !== null) {
			const word = match[0];
			const offset = match.index;
			const position = document.positionAt(offset);

			// 判断是否是函数
			if (userFuncNames.has(word) && !BUILTINS.includes(word) && !KEYWORDS.includes(word)) {
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

		// 判断是否已输入了 '$'
		const range = new vscode.Range(position.translate(0, -1), position);
		const charBeforeCursor = position.character > 0 ? document.getText(range) : '';
		const isTriggeredByDollar = charBeforeCursor === '$';

		// 判断光标是否在函数定义内部
		const currentFunc = functions.find(f => position.line >= f.startLine && position.line <= f.endLine);

		// 参数补全
		if (currentFunc) {
			currentFunc.args.forEach(arg => {
				// 统一格式化为 $name
				const fullVarName = arg.startsWith('$') ? arg : '$' + arg;

				const item = new vscode.CompletionItem(fullVarName, vscode.CompletionItemKind.Variable);
				item.detail = `Parameter of ${currentFunc.name}`;
				item.sortText = "0000";

				// 若已输入了 $ 则补全中不包含 $
				if (isTriggeredByDollar) {
					item.insertText = fullVarName.substring(1);
					item.filterText = fullVarName.substring(1);
				} else {
					item.insertText = fullVarName;
				}

				completions.push(item);
			});
		}

		// 提供用户定义的其他函数
		functions.forEach(f => {
			// 避免递归提示
			if (f.name !== currentFunc?.name) {
				const item = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Function);
				item.detail = `User defined function`;

				// 自动补全参数
				if (f.args.length > 0) {
					const argsSnippet = f.args.map((arg, idx) => `\${${idx + 1}:${arg}}`).join('; ');
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