import type { SVGProps } from 'react';

const S = (p: SVGProps<SVGSVGElement> & { d: string }) => {
  const { d, ...rest } = p;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={16} height={16} aria-hidden {...rest}>
      <path d={d} />
    </svg>
  );
};

export const IFolder = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />;
export const IFolderPlus = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5" />;
export const IPlus = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M12 5v14M5 12h14" />;
export const IMore = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M12 6h.01M12 12h.01M12 18h.01" strokeWidth={3} />;
export const IChevron = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M9 6l6 6-6 6" />;
export const IDown = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M6 9l6 6 6-6" />;
export const IHistory = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />;
export const ITrash = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />;
export const IEdit = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />;
export const IMove = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 13h6M13 10l3 3-3 3" />;
export const ICopy = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M9 9h10v10H9zM5 15H4V5h10v1" />;
export const IPlay = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M7 5l12 7-12 7z" fill="currentColor" />;
export const IPause = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" />;
export const IStart = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M6 5v14M19 5L9 12l10 7z" fill="currentColor" />;
export const IStop = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M6 6h12v12H6z" fill="currentColor" />;
export const IUndo = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />;
export const IRedo = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />;
export const ISave = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M5 3h11l3 3v15H5zM8 3v6h8M8 21v-7h8v7" />;
export const IDownload = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M12 4v11M7 10l5 5 5-5M5 20h14" />;
export const IUpload = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M12 20V9M7 14l5-5 5 5M5 4h14" />;
export const IBack = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M15 6l-6 6 6 6" />;
export const IMusic = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />;
export const IScissors = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.9L20 20M8.1 16.1L20 4" />;
export const IMagic = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M15 4V2M15 10V8M11 6h2M17 6h2M4 20L15 9M18 13v2M17 14h2" />;
export const IHome = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M3 11l9-7 9 7M5 10v10h14V10" />;
export const ICompare = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M8 3v18M16 3v18M3 8h5M16 16h5" />;
export const IRestore = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />;
export const IEye = (p: SVGProps<SVGSVGElement>) => <S {...p} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
export const ILogo = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width={22} height={22} {...p}>
    {[3, 7, 11, 15, 19].map((x, i) => <rect key={x} x={x - 1} y={[8, 4, 2, 5, 9][i]} width={2.2} height={24 - 2 * [8, 4, 2, 5, 9][i]} rx={1.1} fill="#f07a1a" />)}
  </svg>
);
