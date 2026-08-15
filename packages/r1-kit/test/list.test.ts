import { describe, expect, test } from 'vitest'
import { visibleWindow } from '../src/list'

describe('visibleWindow', () => {
  test('shows everything when it fits', () => {
    expect(visibleWindow(2, 3, 44, 176)).toEqual({ start: 0, end: 3 })
  })

  test('centers selection', () => {
    const { start, end } = visibleWindow(5, 20, 44, 176)
    expect(start).toBe(3)
    expect(end).toBe(7)
  })

  test('clamps at the top', () => {
    expect(visibleWindow(0, 20, 44, 176)).toEqual({ start: 0, end: 4 })
  })

  test('clamps at the bottom', () => {
    expect(visibleWindow(19, 20, 44, 176)).toEqual({ start: 16, end: 20 })
  })
})
