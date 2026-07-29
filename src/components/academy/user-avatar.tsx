"use client";

import Image from "next/image";
import { useState } from "react";

type UserAvatarProps = {
  avatarUrl?: string;
  initials: string;
};

export function UserAvatar({
  avatarUrl,
  initials,
}: UserAvatarProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<
    string | undefined
  >();
  const showImage =
    Boolean(avatarUrl) && failedAvatarUrl !== avatarUrl;

  return showImage && avatarUrl ? (
    <Image
      alt=""
      aria-hidden="true"
      className="user-avatar-image"
      draggable={false}
      height={80}
      loading="eager"
      onError={() => setFailedAvatarUrl(avatarUrl)}
      referrerPolicy="no-referrer"
      src={avatarUrl}
      unoptimized
      width={80}
    />
  ) : (
    <span aria-hidden="true" className="user-avatar-fallback">
      {initials}
    </span>
  );
}
