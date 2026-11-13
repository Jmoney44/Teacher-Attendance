import { FC } from 'react';

type BrandProps = {
  compact?: boolean;
};

const Brand: FC<BrandProps> = ({ compact = false }) => (
  <div className="flex items-center gap-3">
    <img className={compact ? 'h-12 w-24 object-contain' : 'h-14 w-28 object-contain'} src="/logo.png" alt="Attendance" />
    {!compact && (
      <div>
        <p className="text-sm font-bold tracking-wide text-brand-900">Attendance</p>
        <p className="text-xs text-slate-500">Teaching & learning, in sync</p>
      </div>
    )}
  </div>
);

export default Brand;
