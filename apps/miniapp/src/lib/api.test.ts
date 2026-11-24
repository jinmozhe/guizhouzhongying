import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Taro from '@tarojs/taro'
import { request } from './api'
import type { Envelope } from './api'

vi.mock('@tarojs/taro', () => ({ default: { request: vi.fn() } }))

describe('request timeout budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('__API_BASE_URL__', 'https://api.example.test')
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it.each([undefined, 20_000])('forwards timeout %s to the native request without retrying a failed write', async (timeoutMs) => {
    let options!: Parameters<typeof Taro.request>[0]
    vi.mocked(Taro.request).mockImplementation((value) => {
      options = value
      return Object.assign(new Promise<Taro.request.SuccessCallbackResult>(() => {}), {
        abort: vi.fn(), onHeadersReceived: vi.fn(), offHeadersReceived: vi.fn(),
        onChunkReceived: vi.fn(), offChunkReceived: vi.fn(),
      })
    })
    const pending = request<Envelope>('/auth/login', { method: 'POST', data: { code: 'unit-code' }, timeoutMs })
    const rejected = expect(pending).rejects.toThrow('网络连接失败')
    expect(options.timeout).toBe(timeoutMs ?? 12_000)
    options.fail?.({ errMsg: 'request:fail timeout' })
    options.complete?.({ errMsg: 'request:fail timeout' })
    await rejected
    expect(Taro.request).toHaveBeenCalledTimes(1)
  })
})
