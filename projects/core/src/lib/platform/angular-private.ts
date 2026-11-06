import * as angularCore from '@angular/core';
import { InjectionToken } from '@angular/core';

/**
 * The token that gives an injector root scope, as an app's bootstrap does for its root injector,
 * so `providedIn: 'root'` services resolve. Angular has no public provider for it, and a private
 * export may go in a minor release. It is read from the namespace when a mount needs it, so a
 * missing one fails that mount with this message instead of failing the import.
 */
export function rootScopeToken(): InjectionToken<string> {
  const token = (angularCore as Record<string, unknown>)['ɵINJECTOR_SCOPE'];
  if (!(token instanceof InjectionToken)) {
    throw new Error(
      'angular-ink: this @angular/core has no ɵINJECTOR_SCOPE, which mounting an app needs; use a version in the supported range (^22.0.0)',
    );
  }
  return token as InjectionToken<string>;
}
