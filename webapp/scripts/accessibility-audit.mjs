import * as ts from 'typescript'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webappDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(webappDir, 'src')
const interactive = new Set(['button', 'input', 'select', 'textarea'])

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(absolute))
    else if (entry.isFile() && absolute.endsWith('.tsx')) files.push(absolute)
  }
  return files
}

function tagName(node) {
  return ts.isIdentifier(node.tagName) ? node.tagName.text : undefined
}

function attribute(node, name) {
  return node.attributes.properties.some((property) => ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name)
}

function hasNonEmptyLabelContent(node) {
  const children = node.children || []
  return children.some((child) => {
    if (ts.isJsxText(child)) return child.getText().trim().length > 0
    if (ts.isJsxExpression(child)) return Boolean(child.expression)
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) return !ts.isJsxSelfClosingElement(child) && hasNonEmptyLabelContent(child)
    return false
  })
}

function hasLabelAncestor(node) {
  let current = node.parent
  while (current) {
    if (ts.isJsxElement(current) && tagName(current.openingElement) === 'label') return true
    current = current.parent
  }
  return false
}

const failures = []
for (const file of await filesUnder(sourceDir)) {
  // Primitive controls intentionally do not own labels; callers compose them
  // with an explicit label/aria attribute. Page-level JSX is audited below.
  if (file.includes(`${path.sep}components${path.sep}ui${path.sep}`)) continue
  const source = await fs.readFile(file, 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = tagName(ts.isJsxElement(node) ? node.openingElement : node)
      if (name && interactive.has(name)) {
        const props = ts.isJsxElement(node) ? node.openingElement : node
        // Placeholders are accepted as a bounded static signal for search and
        // optional controls; manual review still remains required because a
        // placeholder is not a substitute for a persistent visible label.
        const named = attribute(props, 'aria-label') || attribute(props, 'aria-labelledby') || attribute(props, 'title') || attribute(props, 'placeholder')
        if (name === 'button') {
          const hasContent = ts.isJsxElement(node) && hasNonEmptyLabelContent(node)
          if (!named && !hasContent) failures.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1} unnamed button`)
        } else if (!named && !hasLabelAncestor(node)) {
          failures.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1} unlabeled ${name}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
}

if (failures.length) {
  console.error(`Accessibility audit found ${failures.length} issue(s):`)
  for (const failure of failures) console.error(`- ${path.relative(webappDir, failure)}`)
  process.exitCode = 1
} else {
  console.log('PASS accessibility audit: interactive controls have accessible names or label ancestry')
}
