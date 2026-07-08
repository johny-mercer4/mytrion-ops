import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';

// Search input with leading icon — matches every module's list/table toolbar.
export function SearchBar({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border bg-card px-3 py-2 transition-colors focus-within:border-primary/55 focus-within:ring-3 focus-within:ring-primary/12',
        className,
      )}
    >
      <Search className="size-3.5 flex-none text-muted-foreground" />
      <input
        className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        {...props}
      />
    </div>
  );
}
