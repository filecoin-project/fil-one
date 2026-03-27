import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';

describe('Input', () => {
  it('renders with placeholder', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('calls onChange with the change event', () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} placeholder="test" />);
    fireEvent.change(screen.getByPlaceholderText('test'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as React.ChangeEvent<HTMLInputElement>).target.value).toBe(
      'hello',
    );
  });

  it('supports disabled state', () => {
    render(<Input disabled placeholder="test" />);
    expect(screen.getByPlaceholderText('test')).toBeDisabled();
  });
});
