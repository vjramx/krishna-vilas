import { lazy, Suspense } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { LanguageProvider } from '@/context/LanguageContext';
import { CartProvider } from '@/context/CartContext';
import { SnackbarHost } from '@/components/ui';
import OrderNotifier from '@/components/OrderNotifier';
import { RouteEffects } from '@/components/AppChrome';
import { OfflineBanner } from '@/components/OfflineBanner';

const MenuPage = lazy(() => import('@/pages/MenuPage'));
const CartPage = lazy(() => import('@/pages/CartPage'));
const CheckoutPage = lazy(() => import('@/pages/CheckoutPage'));
const OrdersPage = lazy(() => import('@/pages/OrdersPage'));
const OrderDetailPage = lazy(() => import('@/pages/OrderDetailPage'));
const AccountPage = lazy(() => import('@/pages/AccountPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const PrivacyPolicyPage = lazy(() => import('@/pages/PrivacyPolicyPage'));

const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminOrders = lazy(() => import('@/pages/admin/AdminOrders'));
const AdminMenuPage = lazy(() => import('@/pages/admin/AdminMenu'));
const AdminAgents = lazy(() => import('@/pages/admin/AdminAgents'));
const AdminCod = lazy(() => import('@/pages/admin/AdminCod'));
const AdminSettings = lazy(() => import('@/pages/admin/AdminSettings'));
const AdminAccess = lazy(() => import('@/pages/admin/AdminAccess'));
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'));
const AdminStaffLogin = lazy(() => import('@/pages/LoginPage'));

const AgentLayout = lazy(() => import('@/pages/agent/AgentLayout').then((m) => ({ default: m.AgentLayout })));
const AgentAssigned = lazy(() => import('@/pages/agent/AgentHome').then((m) => ({ default: m.AgentAssigned })));
const AgentActive = lazy(() => import('@/pages/agent/AgentHome').then((m) => ({ default: m.AgentActive })));
const AgentCod = lazy(() => import('@/pages/agent/AgentHome').then((m) => ({ default: m.AgentCod })));
const AgentDeliveryPage = lazy(() => import('@/pages/agent/AgentDeliveryPage'));
const AgentPreview = lazy(() => import('@/pages/agent/AgentPreview'));

export default function App() {
  return (
    <LanguageProvider>
      <CartProvider>
        <Suspense fallback={null}>
          <RouteEffects>
            <Routes>
              {/* Customer */}
              <Route path="/" element={<MenuPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/order/:id" element={<OrderDetailPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />

              {/* Admin (gate enforced in AdminLayout via RLS-verified role) */}
              <Route path="/admin/login" element={<AdminStaffLogin />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="menu" element={<AdminMenuPage />} />
                <Route path="agents" element={<AdminAgents />} />
                <Route path="cod" element={<AdminCod />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="access" element={<AdminAccess />} />
                <Route path="users" element={<AdminUsers />} />
              </Route>

              {/* Agent */}
              <Route path="/agent/login" element={<AdminStaffLogin />} />
              {/* Admin-only read-only preview of the delivery workspace */}
              <Route path="/agent/preview" element={<AgentPreview />} />
              <Route path="/agent" element={<AgentLayout />}>
                <Route index element={<AgentAssigned />} />
                <Route path="active" element={<AgentActive />} />
                <Route path="cod" element={<AgentCod />} />
                <Route path="delivery/:id" element={<AgentDeliveryPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </RouteEffects>
        </Suspense>
        <OfflineBanner />
        <OrderNotifier />
        <SnackbarHost />
      </CartProvider>
    </LanguageProvider>
  );
}
