// Inline stroke icons (no icon dependency).

import type { ReactNode } from "react";

interface IconProps {
  size?: number;
}

function svg(path: ReactNode, size = 16) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path}
    </svg>
  );
}

export const PlusIcon = ({ size }: IconProps) => svg(<path d="M12 5v14M5 12h14" />, size);
export const HistoryIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 3" />
    </>,
    size,
  );
export const GearIcon = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>,
    size,
  );
export const SendIcon = ({ size }: IconProps) => svg(<path d="M12 19V5M5 12l7-7 7 7" />, size);
export const StopIcon = ({ size }: IconProps) => svg(<rect x="6" y="6" width="12" height="12" rx="2" />, size);
export const CloseIcon = ({ size }: IconProps) => svg(<path d="M18 6 6 18M6 6l12 12" />, size);
export const BackIcon = ({ size }: IconProps) => svg(<path d="M19 12H5M11 18l-6-6 6-6" />, size);
export const TrashIcon = ({ size }: IconProps) =>
  svg(<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />, size);
export const CheckIcon = ({ size }: IconProps) => svg(<path d="M20 6 9 17l-5-5" />, size);
export const AlertIcon = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>,
    size,
  );
export const ChevronIcon = ({ size }: IconProps) => svg(<path d="m6 9 6 6 6-6" />, size);
export const GlobeIcon = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>,
    size,
  );
export const SparkIcon = ({ size }: IconProps) =>
  svg(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />, size);
export const AtIcon = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </>,
    size,
  );
export const CopyIcon = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
    size,
  );
export const RefreshIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5M3 21v-5h5" />
    </>,
    size,
  );
export const ChartIcon = ({ size }: IconProps) => svg(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />, size);
export const SearchIcon = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
    size,
  );
export const DownloadIcon = ({ size }: IconProps) => svg(<path d="M12 3v12M7 10l5 5 5-5M5 21h14" />, size);
export const BrainIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M12 5a3 3 0 1 0-6 .1 4 4 0 0 0-2.5 5.8 4 4 0 0 0 .6 6.6A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 6 .1 4 4 0 0 1 2.5 5.8 4 4 0 0 1-.6 6.6A4 4 0 1 1 12 18Z" />
      <path d="M12 5v13" />
    </>,
    size,
  );
export const QuestionIcon = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" />
    </>,
    size,
  );
export const QueueIcon = ({ size }: IconProps) => svg(<path d="M4 6h16M4 12h10M4 18h7M17 15v6M14 18h6" />, size);
export const MicIcon = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </>,
    size,
  );
export const PencilIcon = ({ size }: IconProps) => svg(<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />, size);
