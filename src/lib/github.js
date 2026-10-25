/**
 * GitHub 同步客户端：账本数据以单个 data.json 存放在用户自己的私有仓库中
 * Contents API 读写，带 sha 乐观更新
 */
const API = 'https://api.github.com'

async function gh(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status}`)
    err.status = res.status
    try { err.data = await res.json() } catch { /* ignore */ }
    throw err
  }
  return res.status === 204 ? null : res.json()
}

export async function getUser(token) {
  try {
    const u = await gh(token, '/user')
    return { login: u.login, name: u.name || u.login }
  } catch (e) {
    if (e.status === 401) throw new Error('Token 无效或已过期，请检查后重试')
    throw new Error('无法连接 GitHub，请检查网络（需要能访问 api.github.com）')
  }
}

/** 确保数据仓库存在，不存在则创建私有仓库 */
export async function ensureRepo(token, login, name) {
  try {
    await gh(token, `/repos/${login}/${name}`)
    return { created: false }
  } catch (e) {
    if (e.status !== 404) throw e
    await gh(token, '/user/repos', {
      method: 'POST',
      body: { name, private: true, description: '墨账 InkLedger 数据仓库（自动创建）', auto_init: true }
    })
    // 仓库初始化有短暂延迟
    await new Promise((r) => setTimeout(r, 1200))
    return { created: true }
  }
}

export async function readData(token, login, repo, path = 'data.json') {
  try {
    const file = await gh(token, `/repos/${login}/${repo}/contents/${path}`)
    const json = atobUtf8(file.content)
    return { sha: file.sha, data: JSON.parse(json) }
  } catch (e) {
    if (e.status === 404) return { sha: null, data: null }
    throw e
  }
}

export async function writeData(token, login, repo, data, sha, path = 'data.json') {
  const json = JSON.stringify(data, null, 2)
  return gh(token, `/repos/${login}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: { message: `sync: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, content: btoaUtf8(json), sha: sha || undefined }
  })
}

/* —— UTF-8 安全的 base64（含中文） —— */
function btoaUtf8(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}
function atobUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
