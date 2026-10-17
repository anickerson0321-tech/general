import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const fx = (f: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url)))
const shots = process.env.SHOTS_DIR

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` })
}

const LYRICS = `[Verse]
Lights are low and the city hums
I can hear the summer come

[Chorus]
Sing it loud, sing it free
Every word belongs to me`

test('local engine: create → karaoke → record → polish → save', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('./#/')
  await expect(page.getByText('Make a song about')).toBeVisible()
  await shot(page, '01-home')
  await page.goto('./#/create')
  await page.getByRole('button', { name: 'Advanced' }).click()
  await page.getByPlaceholder(/Write your own lyrics/).fill(LYRICS)
  await page.getByPlaceholder(/dreamy synthwave/).fill('upbeat pop, female vocals, 120 bpm')
  await page.getByPlaceholder('Leave blank to auto-name').fill('Summer Hum')
  await page.locator('.create-form').getByRole('button', { name: /^Create$/ }).click()
  const rows = page.locator('.create-list .song-row')
  await expect(rows).toHaveCount(2)
  await shot(page, '02-generating')
  await expect(page.locator('.create-list .song-row .dur')).toHaveCount(2, { timeout: 180_000 })
  await shot(page, '03-created')

  // play in bottom player
  await rows.first().locator('.cover').click()
  await expect(page.locator('.player')).toBeVisible()
  await page.waitForTimeout(800)

  // song page → karaoke
  await rows.first().locator('.meta').click()
  await expect(page.locator('.song-hero h1')).toHaveText('Summer Hum')
  await shot(page, '04-song')
  await page.getByRole('button', { name: 'Sing it' }).click()
  await expect(page.locator('.kara')).toBeVisible()
  await expect(page.getByText('Loading backing track')).toHaveCount(0, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Record' }).click()
  await page.waitForTimeout(9000)
  await shot(page, '05-karaoke')
  await expect(page.locator('.kara-line').first()).toBeVisible()
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page).toHaveURL(/#\/take\//, { timeout: 20_000 })

  // polish
  await expect(page.locator('.polish-level').first()).toBeVisible()
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 })
  await shot(page, '06-take')
  const before = await page.locator('.stat').nth(0).locator('.v').innerText()
  await page.locator('.polish-stops span', { hasText: 'Perfect' }).click()
  await expect(page.locator('.polish-level').first()).toHaveText(/Perfect/)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.stat').nth(1).locator('.v')).toHaveText(/\d+%/, { timeout: 60_000 })
  const after = await page.locator('.stat').nth(1).locator('.v').innerText()
  console.log('in tune before/after:', before, after)
  expect(parseInt(after)).toBeGreaterThanOrEqual(parseInt(before))
  await shot(page, '07-take-perfect')
  await page.locator('.polish-stops span', { hasText: 'Raw' }).click()
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: /Save “My Version”/ }).click()
  await expect(page.locator('.song-hero h1')).toHaveText(/My Version/, { timeout: 60_000 })

  // studio
  await page.goto('./#/studio')
  await page.locator('.song-row', { hasText: 'Summer Hum' }).first().click()
  await expect(page.locator('.track-head').first()).toBeVisible()
  await page.waitForTimeout(4000)
  await shot(page, '08-studio')
  await page.goto('./#/library')
  await expect(page.locator('.song-row')).toHaveCount(3)
  await page.getByRole('button', { name: 'My Vocals' }).click()
  await expect(page.locator('.song-row')).toHaveCount(1)
  await shot(page, '09-library')
  expect(errors.filter((e) => !/favicon|sw\.js/.test(e))).toEqual([])
})

test('cloud engine (mocked fal.ai): simple mode → AI song → stems + synced karaoke', async ({ page }) => {
  const calls: string[] = []
  await page.addInitScript(() => {
    if (!localStorage.getItem('encore.settings.v1'))
      localStorage.setItem('encore.settings.v1', JSON.stringify({ engine: 'fal', keys: { fal: 'test-key' } }))
  })
  const lyrics = '[Verse]\\nMorning light on the window\\nCoffee warm in my hand\\n\\n[Chorus]\\nOh what a day\\nOh what a day'
  await page.route('https://fake.fal.media/**', (r) =>
    r.fulfill({ body: fx(r.request().url().includes('stem') ? 'stem.mp3' : 'song.mp3'), headers: { 'content-type': 'audio/mpeg', 'access-control-allow-origin': '*' } }),
  )
  await page.route('https://queue.fal.run/**', async (r) => {
    const url = new URL(r.request().url())
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    expect(r.request().headers()['authorization']).toBe('Key test-key')
    if (r.request().method() === 'POST') {
      const ep = url.pathname.slice(1)
      calls.push(ep)
      const id = encodeURIComponent(ep)
      return r.fulfill({ headers: cors, body: JSON.stringify({ request_id: id, status_url: `https://queue.fal.run/x/y/requests/${id}/status`, response_url: `https://queue.fal.run/x/y/requests/${id}` }) })
    }
    if (url.pathname.endsWith('/status')) return r.fulfill({ headers: cors, body: JSON.stringify({ status: 'COMPLETED' }) })
    const ep = decodeURIComponent(url.pathname.split('/requests/')[1])
    let out: unknown = {}
    if (ep.startsWith('openrouter')) out = { output: `{"title":"What A Day","style":"sunny indie pop, female vocals","lyrics":"${lyrics}"}` }
    else if (ep === 'fal-ai/demucs') out = { vocals: { url: 'https://fake.fal.media/stem-v.mp3' }, drums: { url: 'https://fake.fal.media/stem-d.mp3' }, bass: { url: 'https://fake.fal.media/stem-b.mp3' }, other: { url: 'https://fake.fal.media/stem-o.mp3' } }
    else if (ep.includes('forced-alignment')) {
      const words = 'Morning light on the window Coffee warm in my hand Oh what a day Oh what a day'.split(' ')
      out = { words: words.map((w, i) => ({ text: w, start: 2 + i * 0.6, end: 2 + i * 0.6 + 0.5 })) }
    } else out = { audio: { url: 'https://fake.fal.media/song.mp3' } }
    return r.fulfill({ headers: cors, body: JSON.stringify(out) })
  })
  await page.goto('./#/create')
  await expect(page.locator('.model-btn')).toContainText('MiniMax Music 3')
  await page.getByPlaceholder(/feel-good summer anthem/).fill('a sunny song about a slow morning')
  await page.locator('.create-form').getByRole('button', { name: /^Create$/ }).click()
  await expect(page.locator('.create-list .song-row .dur')).toHaveCount(2, { timeout: 60_000 })
  await expect(page.locator('.create-list .song-row').first()).toContainText('What A Day')
  await page.goto('./#/karaoke')
  await expect(page.locator('.badge', { hasText: 'synced' })).toHaveCount(2, { timeout: 60_000 })
  expect(calls).toContain('openrouter/router')
  expect(calls).toContain('minimax/music-3')
  expect(calls).toContain('fal-ai/demucs')
  expect(calls).toContain('fal-ai/elevenlabs/forced-alignment')
  await page.locator('.song-row').first().click()
  await expect(page.getByText('Loading backing track')).toHaveCount(0, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(3500)
  await expect(page.locator('.kara-word').first()).toBeVisible()
  await shot(page, '10-cloud-karaoke')
})
