import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './Button';
import { SaveCredentialsModal } from './SaveCredentialsModal';

const meta: Meta<typeof SaveCredentialsModal> = {
  title: 'Components/SaveCredentialsModal',
  component: SaveCredentialsModal,
};

export default meta;
type Story = StoryObj<typeof SaveCredentialsModal>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button variant="primary" onClick={() => setOpen(true)}>
          Show credentials
        </Button>
        <SaveCredentialsModal
          open={open}
          onClose={() => setOpen(false)}
          onDone={() => setOpen(false)}
          credentials={{
            accessKeyId: 'AKIA1234567890EXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          }}
        />
      </>
    );
  },
};
