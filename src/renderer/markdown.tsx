import katex from "katex";
import "katex/dist/katex.min.css";
import { Marked, type Token, type TokenizerExtension, type Tokens } from "marked";
import { memo, type ReactNode, useMemo, useState } from "react";
import { getDesktopSnapshot } from "./desktop-store.ts";
import { resolveWorkspaceFileHref } from "./file-links.ts";
import { MermaidBlock } from "./mermaid-block.tsx";
import { HighlightedCode } from "./syntax-highlight.tsx";

interface MathToken {
	type: "mathInline" | "mathDisplay";
	raw: string;
	text: string;
}

const displayMathExtension: TokenizerExtension = {
	name: "mathDisplay",
	level: "block",
	start: (src) => {
		const dollar = src.search(/^ {0,3}\$\$/mu);
		const bracket = src.search(/^ {0,3}\\\[/mu);
		if (dollar < 0) return bracket < 0 ? undefined : bracket;
		return bracket < 0 ? dollar : Math.min(dollar, bracket);
	},
	tokenizer(src) {
		const dollar = /^( {0,3})\$\$[ \t]*\n?([\s\S]+?)\n?\1\$\$(?:\n|$)/u.exec(src);
		const bracket = /^( {0,3})\\\[[ \t]*\n?([\s\S]+?)\n?\1\\\](?:\n|$)/u.exec(src);
		const match = dollar ?? bracket;
		if (!match) return undefined;
		return { type: "mathDisplay", raw: match[0], text: match[2]?.trim() ?? "" };
	},
};

const inlineMathExtension: TokenizerExtension = {
	name: "mathInline",
	level: "inline",
	start: (src) => {
		const dollar = src.indexOf("$");
		const bracket = src.indexOf("\\(");
		if (dollar < 0) return bracket < 0 ? undefined : bracket;
		return bracket < 0 ? dollar : Math.min(dollar, bracket);
	},
	tokenizer(src) {
		const bracket = /^\\\(([^\n]+?)\\\)/u.exec(src);
		const dollar = /^\$(?![\s$])([^$\n]+?)(?<!\s)\$(?!\$)/u.exec(src);
		const match = bracket ?? dollar;
		if (!match) return undefined;
		return { type: "mathInline", raw: match[0], text: match[1] ?? "" };
	},
};

const markdownLexer = new Marked({ extensions: [displayMathExtension, inlineMathExtension] });

function safeHref(href: string): string | undefined {
	const trimmed = href.trim();
	if (
		trimmed.startsWith("http://") ||
		trimmed.startsWith("https://") ||
		trimmed.startsWith("mailto:") ||
		trimmed.startsWith("file:")
	) {
		return trimmed;
	}
	if (!trimmed.includes(":") && !trimmed.startsWith("//") && !trimmed.startsWith("javascript:")) {
		return trimmed;
	}
	return undefined;
}

const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
	const [copied, setCopied] = useState(false);

	async function handleCopy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1400);
		} catch {
			// Clipboard unavailable; ignore.
		}
	}

	return (
		<div className="code-block">
			<div className="code-block-toolbar">
				<span>{language || "text"}</span>
				<button type="button" aria-label="复制代码" onClick={() => void handleCopy()}>
					{copied ? "已复制" : "复制"}
				</button>
			</div>
			<pre>
				<HighlightedCode code={code} language={language} />
			</pre>
		</div>
	);
});

function renderInline(tokens: Token[]): ReactNode[] {
	const children: ReactNode[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) continue;
		if (token.type === "mathInline") {
			const math = token as unknown as MathToken;
			children.push(<MathExpression key={index} text={math.text} display={false} />);
			continue;
		}
		switch (token.type) {
			case "text": {
				const text = token as Tokens.Text;
				children.push(text.tokens ? renderInline(text.tokens) : text.text);
				break;
			}
			case "strong":
				children.push(<strong key={index}>{renderInline((token as Tokens.Strong).tokens)}</strong>);
				break;
			case "em":
				children.push(<em key={index}>{renderInline((token as Tokens.Em).tokens)}</em>);
				break;
			case "codespan":
				children.push(
					<code className="md-inline-code" key={index}>
						{(token as Tokens.Codespan).text}
					</code>,
				);
				break;
			case "del":
				children.push(<del key={index}>{renderInline((token as Tokens.Del).tokens)}</del>);
				break;
			case "br":
				children.push(<br key={index} />);
				break;
			case "escape":
				children.push((token as Tokens.Escape).text);
				break;
			case "link": {
				const link = token as Tokens.Link;
				const href = safeHref(link.href);
				if (href) {
					const filePath = resolveWorkspaceFileHref(href, getDesktopSnapshot().workspacePath);
					children.push(
						<a
							key={index}
							href={href}
							onClick={(event) => {
								event.preventDefault();
								if (filePath) {
									window.dispatchEvent(new CustomEvent("pi-desktop:open-markdown-file", { detail: filePath }));
								} else {
									void window.piDesktop.openExternalUrl(href);
								}
							}}
						>
							{renderInline(link.tokens)}
						</a>,
					);
				} else {
					children.push(renderInline(link.tokens));
				}
				break;
			}
			case "image": {
				const image = token as Tokens.Image;
				const href = safeHref(image.href);
				if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
					children.push(<img alt={image.text || ""} className="md-inline-image" key={index} src={href} />);
				} else {
					children.push(
						<span className="md-image" key={index}>
							{image.text || image.href}
						</span>,
					);
				}
				break;
			}
			default:
				break;
		}
	}
	return children;
}

function renderBlock(tokens: Token[]): ReactNode[] {
	const children: ReactNode[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) continue;
		if (token.type === "mathDisplay") {
			const math = token as unknown as MathToken;
			children.push(<MathExpression key={index} text={math.text} display />);
			continue;
		}
		switch (token.type) {
			case "heading": {
				const heading = token as Tokens.Heading;
				const inline = renderInline(heading.tokens);
				switch (heading.depth) {
					case 1:
						children.push(<h1 key={index}>{inline}</h1>);
						break;
					case 2:
						children.push(<h2 key={index}>{inline}</h2>);
						break;
					case 3:
						children.push(<h3 key={index}>{inline}</h3>);
						break;
					case 4:
						children.push(<h4 key={index}>{inline}</h4>);
						break;
					case 5:
						children.push(<h5 key={index}>{inline}</h5>);
						break;
					case 6:
						children.push(<h6 key={index}>{inline}</h6>);
						break;
					default:
						children.push(<p key={index}>{inline}</p>);
						break;
				}
				break;
			}
			case "paragraph":
				children.push(<p key={index}>{renderInline((token as Tokens.Paragraph).tokens)}</p>);
				break;
			case "code": {
				const code = token as Tokens.Code;
				children.push(
					code.lang?.toLowerCase() === "mermaid" ? (
						<MermaidBlock key={index} code={code.text} />
					) : (
						<CodeBlock key={index} code={code.text} language={code.lang} />
					),
				);
				break;
			}
			case "blockquote":
				children.push(<blockquote key={index}>{renderBlock((token as Tokens.Blockquote).tokens)}</blockquote>);
				break;
			case "list": {
				const list = token as Tokens.List;
				const ListTag = list.ordered ? "ol" : "ul";
				const start = list.ordered && typeof list.start === "number" && list.start !== 1 ? list.start : undefined;
				children.push(
					<ListTag
						className={list.items.some((item) => item.task) ? "md-task-list" : undefined}
						key={index}
						start={start}
					>
						{list.items.map((item, itemIndex) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: markdown token 列表是静态的、不可重排
							<li className={item.task ? "md-task-item" : undefined} key={itemIndex}>
								{item.task ? <input checked={item.checked === true} disabled readOnly type="checkbox" /> : null}
								{renderBlock(item.tokens)}
							</li>
						))}
					</ListTag>,
				);
				break;
			}
			case "table": {
				const table = token as Tokens.Table;
				children.push(
					<table key={index}>
						<thead>
							<tr>
								{table.header.map((cell, cellIndex) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: 表头单元格顺序固定
									<th key={cellIndex} style={cell.align ? { textAlign: cell.align } : undefined}>
										{renderInline(cell.tokens)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{table.rows.map((row, rowIndex) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: 表格行顺序固定
								<tr key={rowIndex}>
									{row.map((cell, cellIndex) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: 表格单元格顺序固定
										<td key={cellIndex} style={cell.align ? { textAlign: cell.align } : undefined}>
											{renderInline(cell.tokens)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>,
				);
				break;
			}
			case "hr":
				children.push(<hr key={index} />);
				break;
			case "space":
				break;
			case "html":
				break;
			case "text": {
				const text = token as Tokens.Text;
				children.push(<p key={index}>{text.text}</p>);
				break;
			}
			default:
				break;
		}
	}
	return children;
}

export const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }) {
	const tokens = useMemo(() => markdownLexer.lexer(text ?? ""), [text]);
	return <div className="markdown-body">{renderBlock(tokens)}</div>;
});

const MathExpression = memo(function MathExpression({ text, display }: { text: string; display: boolean }) {
	const html = useMemo(
		() =>
			katex.renderToString(text, {
				displayMode: display,
				throwOnError: false,
				strict: "warn",
				trust: false,
			}),
		[display, text],
	);
	return display ? (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX escapes untrusted TeX and trust is explicitly disabled.
		<div className="math-display" dangerouslySetInnerHTML={{ __html: html }} />
	) : (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX escapes untrusted TeX and trust is explicitly disabled.
		<span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />
	);
});
