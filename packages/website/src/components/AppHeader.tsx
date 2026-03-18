import { QuestionIcon, BellIcon, SignOutIcon } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { logout, getMe } from '../lib/api.js';
import { getGravatarUrl } from '../lib/gravatar.js';

export function AppHeader() {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    void getMe()
      .then((me) => {
        if (!isMounted) return;
        setAvatarUrl(getGravatarUrl(me.email));
      })
      .catch(() => {
        if (!isMounted) return;
        setAvatarUrl(null);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <header className="flex h-14 flex-shrink-0 items-center border-b border-zinc-200 bg-white px-4 gap-4">
      {/* Spacer pushes right-side icons to the right */}
      <div className="flex-1" />

      {/* Right-side icon buttons */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Help"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          <QuestionIcon size={18} />
        </button>

        <button
          type="button"
          aria-label="Notifications"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          <BellIcon size={18} />
        </button>

        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="User avatar"
            referrerPolicy="no-referrer"
            className="ml-1 h-8 w-8 rounded-full"
          />
        ) : (
          <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-medium text-white">
            U
          </div>
        )}

        <button
          type="button"
          aria-label="Sign out"
          onClick={logout}
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          <SignOutIcon size={18} />
        </button>
      </div>
    </header>
  );
}
