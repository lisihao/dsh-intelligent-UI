import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { installExperienceStyles } from '../../src/style.js'
import { ReviewApp, type ReviewConfig } from './app.js'
import fixtureCss from './fixture.css'

installExperienceStyles()
const style = document.createElement('style'); style.dataset.dilDocumentReview = 'true'; style.textContent = fixtureCss; document.head.append(style)
let config: ReviewConfig
try { const response = await fetch('/api/review', { cache: 'no-store' }); if (!response.ok) throw Error(`读取本地结果失败（${response.status}）。`); config = await response.json() as ReviewConfig } catch (error) { config = { state: 'failed', message: error instanceof Error ? error.message : String(error) } }
window.__dilDocumentReview = { mounted: 0, failures: 0 }
const root = document.querySelector('#root'); if (!root) throw Error('DIL_DOCUMENT_REVIEW_ROOT_MISSING')
createRoot(root).render(h(ReviewApp, { config }))
