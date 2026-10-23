export type Lang = 'en' | 'kn';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'rejected'
  | 'cancelled';

export type AssignmentStatus =
  | 'none'
  | 'assigned'
  | 'accepted'
  | 'picked_up'
  | 'delivered'
  | 'failed';

export interface HotelSettings {
  id: number;
  name_en: string;
  name_kn: string;
  description_en: string | null;
  description_kn: string | null;
  logo_path: string | null;
  phone: string | null;
  opens_at: string;
  closes_at: string;
  closed_weekdays: number[];
  is_accepting_orders: boolean;
  is_open_override: boolean | null;
  /** How orders reach the customer: 'agent' = dispatch to delivery agents,
   * 'self' = the owner delivers themselves (auto-dispatch off, agents
   * section hidden in admin). */
  fulfillment_mode: 'agent' | 'self';
  delivery_fee: number; // rupees, numeric from DB
  min_order_total: number;
  delivery_areas: string[];
  default_prep_minutes: number;
  default_delivery_minutes: number;
  sample_data: boolean;
}

export interface Category {
  id: string;
  slug: string;
  name_en: string;
  name_kn: string;
  display_order: number;
  is_active: boolean;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name_en: string;
  name_kn: string;
  description_en: string | null;
  description_kn: string | null;
  price: number | string; // PostgREST serializes numeric columns as JSON numbers
  original_price: number | string | null;
  image_path: string | null;
  is_available: boolean;
  is_active: boolean;
  is_featured: boolean;
  is_vegetarian: boolean;
}

export interface Profile {
  id: string;
  display_name: string | null;
  phone: string | null;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  phone: string;
  address_line: string;
  area: string;
  landmark: string | null;
  instructions: string | null;
  payment_method: 'cod';
  status: OrderStatus;
  subtotal: string;
  discount_total: string;
  delivery_fee: string;
  total: string;
  eta_minutes: number | null;
  delay_note: string | null;
  reject_reason: string | null;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  cancelled_by: 'customer' | 'restaurant' | null;
  delivery_latitude: number | string | null;
  delivery_longitude: number | string | null;
  location_accuracy_meters: number | string | null;
  location_source: 'browser_geolocation' | 'map_pin' | 'manual_address' | null;
  location_confirmed_at: string | null;
  delivery_house: string | null;
  delivery_street: string | null;
  delivery_locality: string | null;
  delivery_city: string | null;
  delivery_pincode: string | null;
  delivery_floor: string | null;
  agent_latitude: number | string | null;
  agent_longitude: number | string | null;
  agent_location_accuracy_meters: number | string | null;
  agent_location_at: string | null;
  accepted_at: string | null;
  arrived_at: string | null;
  picked_up_at: string | null;
  customer_reached_at: string | null;
  created_at: string;
  agent_id: string | null;
  assignment_status: AssignmentStatus;
  delivery_fail_reason: string | null;
  delivery_pin: string | null;
  cod_expected: string | null;
  cod_collected: string | null;
  cash_handed_at: string | null;
  cash_verified_at: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name_en: string;
  name_kn: string;
  unit_price: string;
  quantity: number;
  discount_amount: string;
  item_total: string;
}

/** An ordered line with its menu-item snapshot hydrated client-side (null
 * when the item has no snapshot or was deleted from the catalog). */
export type OrderItemWithSnapshot = OrderItem & {
  /** Hydrated from menu_items by menu_item_id; includes id (also used to group repeated rows). */
  menu_items: Pick<MenuItem, 'id' | 'image_path' | 'description_en' | 'description_kn' | 'is_vegetarian'> | null;
};

export interface AdminUser {
  id: string;
  email: string;
}

export interface AgentUser {
  id: string;
  email: string;
  name_en: string;
  phone: string | null;
  is_active: boolean;
}

export interface SpecialOffer {
  id: string;
  title_en: string;
  title_kn: string;
  discount_type: 'percent' | 'flat';
  discount_value: string;
  scope: 'item' | 'category' | 'all';
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

export interface PlaceOrderItemPayload {
  item_id: string;
  quantity: number;
}
