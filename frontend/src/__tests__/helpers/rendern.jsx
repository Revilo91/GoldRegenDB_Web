import { render } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '../../components/Toast';

// Komponenten, die useToast() benutzen, brauchen den Provider im Baum – ohne
// ihn wirft der Hook absichtlich, statt Fehlermeldungen still zu verschlucken.
export function rendereMitToast(ui, options) {
  return render(<ToastProvider>{ui}</ToastProvider>, options);
}
