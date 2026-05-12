import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { sanitizeMarkdownHref } from './markdownSecurity'

interface MarkdownRendererProps {
  content: string
}

type CodeRendererProps = ComponentPropsWithoutRef<'code'> & {
  inline?: boolean
  node?: unknown
  children?: ReactNode
}

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{language || 'code'}</span>
        <button onClick={handleCopy} className="md-code-copy" title="Copy code">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        className="overflow-x-auto rounded-b-lg bg-slate-50 px-4 py-3 text-[0.8125rem] leading-6 text-slate-800"
        style={{ margin: 0 }}
      >
        <code>{children}</code>
      </pre>
    </div>
  )
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }: CodeRendererProps) {
          const match = /language-(\w+)/.exec(className || '')
          if (match) {
            return (
              <CodeBlock language={match[1]}>
                {String(children).replace(/\n$/, '')}
              </CodeBlock>
            )
          }
          if (String(children).includes('\n')) {
            return (
              <CodeBlock language="">
                {String(children).replace(/\n$/, '')}
              </CodeBlock>
            )
          }
          return (
            <code className="inline-code" {...props}>
              {children}
            </code>
          )
        },
        p({ children }) {
          return <p className="md-paragraph">{children}</p>
        },
        ul({ children }) {
          return <ul className="md-list md-list-ul">{children}</ul>
        },
        ol({ children }) {
          return <ol className="md-list md-list-ol">{children}</ol>
        },
        li({ children }) {
          return <li className="md-list-item">{children}</li>
        },
        h1({ children }) {
          return <h1 className="md-heading md-h1">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="md-heading md-h2">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="md-heading md-h3">{children}</h3>
        },
        h4({ children }) {
          return <h4 className="md-heading md-h4">{children}</h4>
        },
        blockquote({ children }) {
          return <blockquote className="md-blockquote">{children}</blockquote>
        },
        table({ children }) {
          return (
            <div className="md-table-wrapper">
              <table className="md-table">{children}</table>
            </div>
          )
        },
        thead({ children }) {
          return <thead className="md-table-head">{children}</thead>
        },
        tbody({ children }) {
          return <tbody className="md-table-body">{children}</tbody>
        },
        tr({ children }) {
          return <tr className="md-table-row">{children}</tr>
        },
        th({ children }) {
          return <th className="md-table-cell md-table-header">{children}</th>
        },
        td({ children }) {
          return <td className="md-table-cell">{children}</td>
        },
        a({ children, href }) {
          const safeHref = sanitizeMarkdownHref(
            href,
            typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
          )
          if (!safeHref) {
            return <span className="md-link text-slate-500 no-underline">{children}</span>
          }
          return (
            <a href={safeHref} target="_blank" rel="noopener noreferrer" className="md-link">
              {children}
            </a>
          )
        },
        hr() {
          return <hr className="md-hr" />
        },
        strong({ children }) {
          return <strong className="md-strong">{children}</strong>
        },
        em({ children }) {
          return <em className="md-em">{children}</em>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
