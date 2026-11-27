import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Frontend API URL Smoke Test', () => {
  it('ensures no page or component calls api.get/post/put/delete with /api prefix (baseURL collision)', () => {
    const srcDir = path.resolve(__dirname, '..')

    const findSourceFiles = (dir: string): string[] => {
      let results: string[] = []
      const list = fs.readdirSync(dir)
      for (const file of list) {
        const fullPath = path.join(dir, file)
        const stat = fs.statSync(fullPath)
        if (stat && stat.isDirectory()) {
          if (file !== 'node_modules' && file !== 'dist' && file !== '__tests__') {
            results = results.concat(findSourceFiles(fullPath))
          }
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          results.push(fullPath)
        }
      }
      return results
    }

    const files = findSourceFiles(srcDir)
    const violations: { file: string; line: number; match: string }[] = []

    // Pattern matching api.get('/api/..., api.post('/api/..., etc.
    const apiCallRegex = /api\.(get|post|put|delete|patch)\s*\(\s*['"`]\/api\//g

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      lines.forEach((lineText: string, idx: number) => {
        if (apiCallRegex.test(lineText)) {
          violations.push({
            file: path.relative(srcDir, file),
            line: idx + 1,
            match: lineText.trim(),
          })
        }
      })
    }


    expect(
      violations,
      `Found ${violations.length} occurrence(s) of api.*('/api/...') which causes duplicate /api/api/... 404s:\n${violations
        .map((v) => `  ${v.file}:${v.line} -> ${v.match}`)
        .join('\n')}`
    ).toEqual([])
  })

  it('ensures no hard-coded bare /login, /api, or /assets/ paths bypass appBase/apiBase', () => {
    const srcDir = path.resolve(__dirname, '../..')

    const findSourceFiles = (dir: string): string[] => {
      let results: string[] = []
      const list = fs.readdirSync(dir)
      for (const file of list) {
        const fullPath = path.join(dir, file)
        const stat = fs.statSync(fullPath)
        if (stat && stat.isDirectory()) {
          if (file !== 'node_modules' && file !== 'dist' && file !== 'dist-renewals' && file !== '__tests__') {
            results = results.concat(findSourceFiles(fullPath))
          }
        } else if ((file.endsWith('.ts') || file.endsWith('.tsx')) && file !== 'appBase.ts') {
          results.push(fullPath)
        }
      }
      return results
    }

    const files = findSourceFiles(srcDir)
    const violations: string[] = []

    const patterns: { name: string; re: RegExp }[] = [
      // Raw browser navigation / anchor / media attributes bypassing BrowserRouter basename
      { name: 'hard-coded href="/..."', re: /\bhref\s*=\s*["']\/(?!renewals)/ },
      { name: 'hard-coded src="/..."', re: /\bsrc\s*=\s*["']\/(?!renewals)/ },
      { name: 'hard-coded window.location="/login..."', re: /window\.location\.(?:href|replace|assign|pathname)\s*[=!]=*\s*\(?['"`]\/login/ },
      // Hard-coded /assets/ anywhere outside appBase
      { name: 'hard-coded /assets/', re: /['"`]\/assets\// },
      // Hard-coded /api in code expressions (baseURL, href, fetch, template URL, string concat)
      { name: 'hard-coded /api path literal', re: /(?:baseURL\s*:|href\s*=|\bfetch\s*\(|window\.location\.href\s*=|return\s+)[^;\n]*['"`]\/api(?:\/|['"`])/ },
      { name: 'hard-coded /api/ URL string', re: /\|\|\s*['"`]\/api\// },
    ]

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      lines.forEach((lineText: string, idx: number) => {
        const trimmed = lineText.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
        for (const { name, re } of patterns) {
          if (re.test(lineText)) {
            violations.push(`${path.relative(srcDir, file)}:${idx + 1} [${name}] -> ${trimmed}`)
          }
        }
      })
    }

    expect(
      violations,
      `Found hard-coded root-relative path(s) bypassing appBase/apiBase:\n${violations.join('\n')}`
    ).toEqual([])
  })
})
