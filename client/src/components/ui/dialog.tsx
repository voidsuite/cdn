import * as React from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { useId } from 'react'

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  const id = useId()

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center min-h-screen p-4">
          <RadixDialog.Content
            className={"mx-auto w-full max-w-md transform-gpu rounded-lg bg-card p-6 outline-none shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=open]:slide-in-from-bottom-0 " + (className ?? "")}
            aria-labelledby={`dialog-title-${id}`}
            aria-describedby={description ? `dialog-desc-${id}` : undefined}
          >
            {title && <RadixDialog.Title id={`dialog-title-${id}`} className="text-sm font-semibold">{title}</RadixDialog.Title>}
            {description && <RadixDialog.Description id={`dialog-desc-${id}`} className="text-xs text-muted-foreground mt-1">{description}</RadixDialog.Description>}
            <div className="mt-4">{children}</div>
            <RadixDialog.Close className="sr-only">Close</RadixDialog.Close>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export default Dialog
