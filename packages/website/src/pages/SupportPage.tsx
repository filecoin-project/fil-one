import { useState } from 'react';

import { CalendarIcon, ChatCircleIcon, EnvelopeIcon } from '@phosphor-icons/react/dist/ssr';

import { Button } from '../components/Button';
import { Input } from '../components/Input/index.js';
import { Label } from '../components/Label/index.js';
import { TextArea } from '../components/TextArea/index.js';
import { Heading } from '../components/Heading/index.js';
import { useToast } from '../components/Toast';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SupportPage() {
  const { toast } = useToast();

  // Contact form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formMessage, setFormMessage] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // UNKNOWN: Real support ticket / email API not implemented — UI-only.
    setFormName('');
    setFormEmail('');
    setFormSubject('');
    setFormMessage('');
    toast.success("Message sent! We'll get back to you within 1 business day.");
  }

  return (
    <div className="p-8">
      <Heading tag="h1" size="2xl" className="mb-6">
        Talk to an Expert
      </Heading>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* ---------------------------------------------------------------- */}
        {/* Left column — contact info */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-lg border border-zinc-200 bg-white p-6">
          <Heading tag="h2" size="lg" className="mb-2">
            Get in touch
          </Heading>
          <p className="text-sm text-zinc-600 mb-6">We typically respond within 1 business day.</p>

          {/* Email support */}
          <div className="flex items-start gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 flex-shrink-0">
              <EnvelopeIcon size={16} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-zinc-900">Email support</span>
              {/* UNKNOWN: Confirm the correct support email address. */}
              <span className="text-sm text-zinc-500">support@fil.one</span>
            </div>
          </div>

          {/* Chat */}
          <div className="flex items-start gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 flex-shrink-0">
              <ChatCircleIcon size={16} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-zinc-900">Chat (coming soon)</span>
              <span className="text-sm text-zinc-500">Available Mon–Fri, 9am–5pm PT</span>
            </div>
          </div>

          {/* Schedule a call */}
          <div className="flex items-start gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 flex-shrink-0">
              <CalendarIcon size={16} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-zinc-900">Schedule a call</span>
              <span className="text-sm text-zinc-500">
                Book a 30-minute intro call with our team
              </span>
            </div>
          </div>

          {/* UNKNOWN: Real Calendly / scheduling link not provided — using # as placeholder. */}
          <Button variant="ghost" asChild>
            <a href="#">Schedule call →</a>
          </Button>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Right column — contact form */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-lg border border-zinc-200 bg-white p-6">
          <Heading tag="h2" size="lg" className="mb-4">
            Send a message
          </Heading>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Subject</Label>
              <Input
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                placeholder="How can we help?"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Message</Label>
              <TextArea
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="Describe your question or issue..."
                rows={5}
                required
              />
            </div>

            <div className="flex justify-end">
              <Button variant="default" type="submit">
                Send message
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
