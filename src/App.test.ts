import { describe, expect, it } from 'vitest'
import { clampTilt } from './App'

describe('clampTilt', () => {
  it('limits values to the allowed 3D tilt range', () => {
    expect(clampTilt(25)).toBe(10)
    expect(clampTilt(-20)).toBe(-10)
    expect(clampTilt(4)).toBe(4)
  })
})
