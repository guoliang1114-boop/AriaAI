import React from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface MarkdownRendererProps {
  content: string
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <ReactMarkdown
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '')
            return !inline && match ? (
              <SyntaxHighlighter
                style={oneDark}
                language={match[1]}
                PreTag="div"
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
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
            return (
              <blockquote className="md-blockquote">
                {children}
              </blockquote>
            )
          },
          table({ children }) {
            return (
              <div className="md-table-wrapper">
                <table className="md-table">
                  {children}
                </table>
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
            return (
              <th className="md-table-cell md-table-header">
                {children}
              </th>
            )
          },
          td({ children }) {
            return (
              <td className="md-table-cell">
                {children}
              </td>
            )
          },
          a({ children, href }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="md-link"
              >
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
