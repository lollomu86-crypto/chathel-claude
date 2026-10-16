declare namespace React {
  type ReactNode = string | number | boolean | null | undefined | ReactElement | Iterable<ReactNode>;
  interface ReactElement { type: unknown; props: unknown; key: string | null }
  type Dispatch<A> = (value: A) => void;
  type SetStateAction<S> = S | ((prev: S) => S);
  type RefObject<T> = { current: T };
  type MutableRefObject<T> = { current: T };
  interface SyntheticEvent<T = Element> { currentTarget: T; target: EventTarget & { value?: string; checked?: boolean }; preventDefault(): void; stopPropagation(): void }
  type FormEvent<T = Element> = SyntheticEvent<T>;
  type ChangeEvent<T = Element> = SyntheticEvent<T> & { target: T & EventTarget };
  type MouseEvent<T = Element> = SyntheticEvent<T>;
  type KeyboardEvent<T = Element> = SyntheticEvent<T> & { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; nativeEvent: { isComposing?: boolean } };
  type ReactEventHandler<E> = (e: E) => void;
  function useState<S>(init: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  function useLayoutEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  function useRef<T>(init: T): MutableRefObject<T>;
  function useRef<T>(init: T | null): RefObject<T | null>;
  function useRef<T = undefined>(): MutableRefObject<T | undefined>;
  function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  function useCallback<T extends (...a: never[]) => unknown>(fn: T, deps: readonly unknown[]): T;
  function useId(): string;
  function useContext<T>(c: Context<T>): T;
  interface Context<T> { Provider: (p: { value: T; children?: ReactNode }) => ReactElement | null }
  function createContext<T>(def: T): Context<T>;
  function useSyncExternalStore<T>(sub: (cb: () => void) => () => void, get: () => T, getServer?: () => T): T;
  function Fragment(p: { children?: ReactNode }): ReactElement;
  function Suspense(p: { children?: ReactNode; fallback?: ReactNode }): ReactElement;
  const StrictMode: (p: { children?: ReactNode }) => ReactElement;
  function createElement(type: unknown, props?: unknown, ...children: unknown[]): ReactElement;
  type FC<P = object> = (p: P) => ReactElement | null;
  type ComponentType<P = object> = (p: P) => ReactElement | null;
}
declare module 'react' { export = React; }
declare module 'react-dom/client' { export function createRoot(el: Element): { render(n: unknown): void; unmount(): void }; }
declare module 'react-dom/server' { export function renderToString(n: unknown): string; }
declare module 'react/jsx-runtime' { export const jsx: unknown; export const jsxs: unknown; export const Fragment: unknown }

interface HandlerProps {
  onChange?: (e: import('react').ChangeEvent<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>) => void;
  onInput?: (e: import('react').FormEvent<HTMLInputElement & HTMLTextAreaElement>) => void;
  onClick?: (e: import('react').MouseEvent<HTMLElement>) => void;
  onSubmit?: (e: import('react').FormEvent<HTMLFormElement>) => void;
  onKeyDown?: (e: import('react').KeyboardEvent<HTMLElement>) => void;
  onKeyUp?: (e: import('react').KeyboardEvent<HTMLElement>) => void;
  onFocus?: (e: import('react').SyntheticEvent<HTMLElement>) => void;
  onBlur?: (e: import('react').SyntheticEvent<HTMLElement>) => void;
  onClose?: (e: import('react').SyntheticEvent<HTMLDialogElement>) => void;
  onCancel?: (e: import('react').SyntheticEvent<HTMLDialogElement>) => void;
  ref?: unknown;
  key?: string | number;
  children?: import('react').ReactNode;
  [attr: string]: unknown;
}
declare namespace JSX {
    type Element = import('react').ReactElement;
    interface IntrinsicElements { [tag: string]: HandlerProps }
    interface ElementChildrenAttribute { children: unknown }
    interface IntrinsicAttributes { key?: string | number }
}

