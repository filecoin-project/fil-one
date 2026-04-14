import type { Meta, StoryObj } from '@storybook/react-vite';

import { Radio } from './Radio';

const meta: Meta<typeof Radio> = {
  title: 'Components/Radio',
  component: Radio,
};

export default meta;
type Story = StoryObj<typeof Radio>;

export const Unchecked: Story = {
  args: {
    name: 'example',
    value: 'a',
    checked: false,
    onChange: () => {},
  },
};

export const Checked: Story = {
  args: {
    name: 'example',
    value: 'a',
    checked: true,
    onChange: () => {},
  },
};
