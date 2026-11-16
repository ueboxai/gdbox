import { describe, expect, it } from 'vitest'
import { buildTag, shortVersion } from './godotVersion'

describe('godotVersion', () => {
  it.each([
    ['4.7.1.stable.official.a13da4feb', '4.7.1', ''],
    ['4.3.stable.mono.official.77dcf97d8', '4.3', '.NET'],
    ['4.5.beta2.official.abc', '4.5', 'beta2'],
    ['4.5.rc1.mono.official.abc', '4.5', 'rc1 .NET']
  ])('%s', (raw, version, tag) => {
    expect(shortVersion(raw)).toBe(version)
    expect(buildTag(raw)).toBe(tag)
  })
})
