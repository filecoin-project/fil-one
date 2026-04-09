import type { Meta, StoryObj } from '@storybook/react-vite';

import { CopyableField } from './CopyableField';

const meta: Meta<typeof CopyableField> = {
  title: 'Components/CopyableField',
  component: CopyableField,
};

export default meta;
type Story = StoryObj<typeof CopyableField>;

export const Default: Story = {
  args: {
    label: 'Access Key',
    value: 'AKIA1234567890EXAMPLE',
  },
};

export const LongValue: Story = {
  args: {
    label: 'Secret Key',
    value: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      <CopyableField label="Access Key" value="AKIA1234567890EXAMPLE" />
      <CopyableField label="Secret Key" value="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" />
      <CopyableField label="Endpoint" value="https://s3.filone.io" />
    </div>
  ),
};
