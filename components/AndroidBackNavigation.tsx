import { useEffect, useRef, type MutableRefObject } from 'react';
import { BackHandler, Platform } from 'react-native';
import type { NavigationState } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { showAppToast } from '../lib/app-toast';

const EXIT_CONFIRM_MS = 2000;
const INBOX_HREF = '/(workspace)/inbox' as const;
const WHATSAPP_LIST_HREF = '/(workspace)/whatsapp' as const;

type ParsedPath = {
  module: string;
  rest: string[];
};

/** e.g. /calls → calls, /inbox/compose → inbox + [compose] */
export function parseAppPathname(pathname: string): ParsedPath {
  const parts = pathname.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean);
  return { module: parts[0] ?? '', rest: parts.slice(1) };
}

export function isInboxListPath(pathname: string): boolean {
  const { module, rest } = parseAppPathname(pathname);
  if (module !== 'inbox') return false;
  return rest.length === 0 || (rest.length === 1 && rest[0] === 'index');
}

export function isInboxComposePath(pathname: string): boolean {
  const { module, rest } = parseAppPathname(pathname);
  return module === 'inbox' && rest[0] === 'compose';
}

export function isInboxThreadPath(pathname: string): boolean {
  const { module, rest } = parseAppPathname(pathname);
  if (module !== 'inbox') return false;
  if (rest.length === 0 || rest[0] === 'index' || rest[0] === 'compose') return false;
  return true;
}

export function getFocusedStackRouteName(state: NavigationState | undefined): string | null {
  if (!state?.routes?.length) return null;
  const route = state.routes[state.index ?? 0];
  if (route.state) return getFocusedStackRouteName(route.state as NavigationState);
  return typeof route.name === 'string' ? route.name : null;
}

function isNonInboxModule(pathname: string, routeName: string | null): boolean {
  const { module } = parseAppPathname(pathname);
  if (module && module !== 'inbox') return true;
  if (routeName && !routeName.startsWith('inbox/')) return true;
  return false;
}

function isInboxListScreen(pathname: string, routeName: string | null): boolean {
  if (isNonInboxModule(pathname, routeName)) return false;
  if (routeName === 'inbox/index') return true;
  return isInboxListPath(pathname);
}

function isInboxThreadScreen(pathname: string, routeName: string | null): boolean {
  if (isNonInboxModule(pathname, routeName)) return false;
  if (routeName === 'inbox/[id]') return true;
  return isInboxThreadPath(pathname);
}

function isInboxComposeScreen(pathname: string, routeName: string | null): boolean {
  return routeName === 'inbox/compose' || isInboxComposePath(pathname);
}

function isWhatsAppListScreen(pathname: string, routeName: string | null): boolean {
  if (routeName === 'whatsapp/index') return true;
  const { module, rest } = parseAppPathname(pathname);
  if (module !== 'whatsapp') return false;
  return rest.length === 0 || rest[0] === 'index';
}

function isWhatsAppContactScreen(pathname: string, routeName: string | null): boolean {
  if (routeName === 'whatsapp/contact/[peer]') return true;
  const { module, rest } = parseAppPathname(pathname);
  return module === 'whatsapp' && rest[0] === 'contact';
}

function isWhatsAppPeerChatScreen(pathname: string, routeName: string | null): boolean {
  if (routeName === 'whatsapp/[peer]') return true;
  const { module, rest } = parseAppPathname(pathname);
  if (module !== 'whatsapp') return false;
  if (rest.length !== 1) return false;
  return rest[0] !== 'index' && rest[0] !== 'contact';
}

type Props = {
  drawerOpen: boolean;
  closeDrawer: () => void;
  pathname: string;
  routeName: string | null;
  mailInboxBackRef: MutableRefObject<(() => boolean) | null>;
};

/**
 * Android hardware back (registered once — screen handlers run first):
 * - WhatsApp chat → WhatsApp list
 * - WhatsApp contact info → previous chat screen
 * - WhatsApp list → inbox
 * - Other non-inbox → inbox (single back, no exit toast)
 * - Inbox thread → back to inbox list
 * - Mail sub-views (Drafts, Starred, Sent, labels, …) → main Inbox
 * - Inbox main list only → double-back to exit
 */
export function AndroidBackNavigation({
  drawerOpen,
  closeDrawer,
  pathname,
  routeName,
  mailInboxBackRef,
}: Props) {
  const router = useRouter();

  const lastBackAtRef = useRef(0);
  const drawerOpenRef = useRef(drawerOpen);
  const closeDrawerRef = useRef(closeDrawer);
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  const routeNameRef = useRef(routeName);
  const mailInboxBackRefRef = useRef(mailInboxBackRef);

  drawerOpenRef.current = drawerOpen;
  closeDrawerRef.current = closeDrawer;
  routerRef.current = router;
  pathnameRef.current = pathname;
  routeNameRef.current = routeName;
  mailInboxBackRefRef.current = mailInboxBackRef;

  useEffect(() => {
    if (!isInboxListScreen(pathname, routeName)) {
      lastBackAtRef.current = 0;
    }
  }, [pathname, routeName]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onHardwareBack = (): boolean => {
      const path = pathnameRef.current;
      const route = routeNameRef.current;

      if (drawerOpenRef.current) {
        closeDrawerRef.current();
        return true;
      }

      if (isInboxComposeScreen(path, route)) {
        return false;
      }

      if (isWhatsAppContactScreen(path, route)) {
        lastBackAtRef.current = 0;
        routerRef.current.back();
        return true;
      }

      if (isWhatsAppPeerChatScreen(path, route)) {
        lastBackAtRef.current = 0;
        routerRef.current.replace(WHATSAPP_LIST_HREF);
        return true;
      }

      if (isWhatsAppListScreen(path, route)) {
        lastBackAtRef.current = 0;
        routerRef.current.replace(INBOX_HREF);
        return true;
      }

      if (isNonInboxModule(path, route)) {
        lastBackAtRef.current = 0;
        routerRef.current.replace(INBOX_HREF);
        return true;
      }

      if (isInboxThreadScreen(path, route)) {
        lastBackAtRef.current = 0;
        routerRef.current.back();
        return true;
      }

      if (isInboxListScreen(path, route)) {
        const stepBackInMail = mailInboxBackRefRef.current.current;
        if (stepBackInMail?.()) {
          lastBackAtRef.current = 0;
          return true;
        }

        const now = Date.now();
        if (now - lastBackAtRef.current < EXIT_CONFIRM_MS) {
          BackHandler.exitApp();
          return true;
        }
        lastBackAtRef.current = now;
        showAppToast('Press back again to exit', 'info', EXIT_CONFIRM_MS);
        return true;
      }

      lastBackAtRef.current = 0;
      routerRef.current.replace(INBOX_HREF);
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, []);

  return null;
}
