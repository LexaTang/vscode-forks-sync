import type { ExtensionQueryResponse, ExtensionsGallery, OpenVsxExtension } from './types'
import { Buffer } from 'node:buffer'
import { ofetch } from 'ofetch'
import { Uri } from 'vscode'
import { jsonStringify } from './json'
import { getStorageUri } from './storage'
import { logger } from './utils'

// ─── Open VSX ─────────────────────────────────────────────────────────────────

/**
 * Download a VSIX from open-vsx.org (or another compatible gallery).
 * Endpoint: GET /api/{namespace}/{name}/file/{namespace}.{name}-{version}.vsix
 */
async function getVsixUrlFromOpenVsx(id: string, gallery: ExtensionsGallery): Promise<string> {
  // id is "publisher.name"
  const [namespace, name] = id.split('.')
  if (!namespace || !name)
    throw new Error(`Invalid extension id: ${id}`)

  // Derive API base from gallery serviceUrl
  // open-vsx serviceUrl: https://open-vsx.org/vscode/gallery
  // API base:            https://open-vsx.org/api
  const base = gallery.serviceUrl.replace(/\/vscode\/gallery\/?$/, '')
  const apiBase = base.endsWith('/api') ? base : `${base}/api`

  const meta = await ofetch<OpenVsxExtension>(`${apiBase}/${namespace}/${name}`, {
    timeout: 15_000,
  })

  const vsixUrl = meta.files?.download
  if (!vsixUrl)
    throw new Error(`No download URL found for ${id} on open-vsx`)

  return vsixUrl
}

// ─── VS Marketplace ───────────────────────────────────────────────────────────

async function getVsixUrlFromMarketplace(id: string): Promise<string> {
  const data = await ofetch<ExtensionQueryResponse>(
    'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json;api-version=7.1-preview.1',
        'Content-Type': 'application/json',
      },
      body: jsonStringify({
        assetTypes: ['Microsoft.VisualStudio.Services.VSIXPackage'],
        filters: [
          {
            criteria: [
              { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
              { filterType: 10, value: id },
              { filterType: 12, value: '37888' },
            ],
            pageNumber: 1,
            pageSize: 1,
            sortBy: 0,
            sortOrder: 0,
          },
        ],
        flags: 914,
      }),
      timeout: 15_000,
    },
  )

  const ext = data?.results?.[0]?.extensions?.[0]
  const pkg = ext?.versions?.[0]?.files?.find(f => f.assetType.includes('VSIXPackage'))
  if (!pkg)
    throw new Error(`No VSIXPackage found for ${id} on VS Marketplace`)
  return pkg.source
}

// ─── Public downloader ────────────────────────────────────────────────────────

/**
 * Download a VSIX for `id`, trying sources in priority order:
 *   1. Gallery from extensions.json (defaults to open-vsx)
 *   2. VS Marketplace (fallback)
 *
 * Returns the Uri of the downloaded .vsix file in the storage temp directory.
 */
export async function downloadVsixPackage(
  id: string,
  gallery: ExtensionsGallery | null,
): Promise<Uri> {
  const filename = id.endsWith('.vsix') ? id : `${id}.vsix`
  const uri = Uri.joinPath(getStorageUri(), 'vsix', filename)

  // ── Return cached VSIX if it already exists ──
  try {
    const { workspace } = await import('vscode')
    await workspace.fs.stat(uri)
    logger.info(`Using cached VSIX for ${id}: ${uri.fsPath}`)
    return uri
  }
  catch {
    // Not cached, proceed to download
  }

  const sources: Array<() => Promise<string>> = []

  if (gallery?.serviceUrl) {
    sources.push(() => getVsixUrlFromOpenVsx(id, gallery))
  }
  // Always add marketplace as the final fallback
  sources.push(() => getVsixUrlFromMarketplace(id))

  let url: string | undefined
  for (const trySource of sources) {
    try {
      url = await trySource()
      break
    }
    catch (error) {
      logger.warn(`Source failed for ${id}: ${error}`)
    }
  }

  if (!url)
    throw new Error(`Could not find a download URL for extension: ${id}`)

  logger.info(`Downloading ${id} from: ${url}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok)
    throw new Error(`Failed to download ${id}: HTTP ${response.status}`)
  const arrayBuf = await response.arrayBuffer()

  // Ensure vsix subdirectory exists
  const { workspace } = await import('vscode')
  await workspace.fs.createDirectory(Uri.joinPath(getStorageUri(), 'vsix'))
  await workspace.fs.writeFile(uri, Buffer.from(arrayBuf))
  logger.info(`Cached VSIX for ${id} at: ${uri.fsPath}`)
  return uri
}
