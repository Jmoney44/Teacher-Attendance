import { FC, useEffect } from 'react';

type TablePaginationProps = {
  label: string;
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const pageSizes = [10, 20, 50];

const TablePagination: FC<TablePaginationProps> = ({
  label,
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  useEffect(() => {
    if (page !== currentPage) onPageChange(currentPage);
  }, [currentPage, onPageChange, page]);

  if (totalItems === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-slate-500 sm:justify-start sm:text-sm">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            aria-label={`Rows per page for ${label}`}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <span aria-live="polite">Showing {firstItem}–{lastItem} of {totalItems}</span>
      </div>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <button
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          aria-label={`Previous ${label} page`}
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <span className="sm:hidden">Prev</span>
          <span className="hidden sm:inline">Previous</span>
        </button>
        <span className="min-w-20 text-center text-sm font-medium text-slate-600" aria-label={`Page ${currentPage} of ${totalPages}`}>
          {currentPage} / {totalPages}
        </span>
        <button
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          aria-label={`Next ${label} page`}
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default TablePagination;
