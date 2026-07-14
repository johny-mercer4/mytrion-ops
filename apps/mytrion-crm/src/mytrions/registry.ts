import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { MytrionId } from '../access/mytrions.config';

/**
 * Lazy module registry consumed by MytrionGuard. Each entry code-splits its Mytrion so a Sales agent
 * never downloads the Admin bundle. Every module default-exports a component that renders its own
 * <MytrionShell>.
 */
export const MYTRION_MODULES: Record<MytrionId, LazyExoticComponent<ComponentType>> = {
  admin: lazy(() => import('./admin')),
  sales: lazy(() => import('./sales')),
  billing: lazy(() => import('./billing')),
  collection: lazy(() => import('./collection')),
  finance: lazy(() => import('./finance')),
  retention: lazy(() => import('./retention')),
  verification: lazy(() => import('./verification')),
  'customer-service': lazy(() => import('./customer-service')),
  manager: lazy(() => import('./manager')),
  analyst: lazy(() => import('./analyst')),
};
