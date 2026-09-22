import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CustomSelect from '../../src/components/CustomSelect'

const options = [{ value: 'ua', label: 'Ukraine' }, { value: 'nl', label: 'Netherlands' }]

describe('CustomSelect', () => {
  it('supports an associated label and selecting an option with the keyboard', () => {
    const onChange = vi.fn()
    render(<><label htmlFor="region">Region</label><CustomSelect id="region" value="ua" onChange={onChange} options={options} /></>)
    const trigger = screen.getByLabelText('Region')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Ukraine' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Netherlands' })).toHaveFocus()
    fireEvent.click(document.activeElement)
    expect(onChange).toHaveBeenCalledWith('nl')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on Escape without selecting a value or closing the surrounding dialog', () => {
    const onChange = vi.fn()
    const onKeyDown = vi.fn()
    render(<div onKeyDown={onKeyDown}><CustomSelect aria-label="Region" value="ua" onChange={onChange} options={options} /></div>)
    const trigger = screen.getByLabelText('Region')
    fireEvent.click(trigger)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes an open dropdown when disabled and stays closed after re-enabling', async () => {
    const props = { 'aria-label': 'Region', value: 'ua', onChange: vi.fn(), options }
    const { rerender } = render(<CustomSelect {...props} />)
    fireEvent.click(screen.getByLabelText('Region'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    rerender(<CustomSelect {...props} disabled />)
    expect(screen.getByLabelText('Region')).toBeDisabled()
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    rerender(<CustomSelect {...props} />)
    expect(screen.getByLabelText('Region')).toHaveAttribute('aria-expanded', 'false')
  })
})
