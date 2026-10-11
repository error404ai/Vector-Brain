import { MUIProvider } from '@/components/providers/MUIProvider';
import { ErrorModal } from './ErrorModal';

/** The error modal with its theme, as its own chunk: only fetched once an error is shown. */
export default function ErrorModalWithTheme() {
  return (
    <MUIProvider>
      <ErrorModal />
    </MUIProvider>
  );
}
