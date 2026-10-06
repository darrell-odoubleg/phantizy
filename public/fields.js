// fields.js
// Single source of truth for the offer sheet and advance sheet fields.
// Loaded by the browser (renders the forms) and required by the server
// (column whitelist, schema, PDF layout), so a field added here shows up
// everywhere at once. New keys also need nothing else: db/init.js adds any
// missing column on startup.

(function (root) {
  const OFFER_SECTIONS = [
    { title: 'Artist & Agent', fields: [
      { key: 'artist_name', label: 'Artist', required: true },
      { key: 'agency', label: 'Agency' },
      { key: 'agent_name', label: 'Agent' },
      { key: 'agent_email', label: 'Agent email', type: 'email' },
      { key: 'agent_phone', label: 'Agent phone', type: 'tel' },
    ]},
    { title: 'Event', fields: [
      { key: 'event_name', label: 'Event / show name' },
      { key: 'event_date', label: 'Show date', type: 'date' },
      { key: 'alt_dates', label: 'Alternate dates' },
      { key: 'doors_time', label: 'Doors', type: 'time' },
      { key: 'show_time', label: 'Show time', type: 'time' },
      { key: 'set_length', label: 'Set length' },
      { key: 'billing', label: 'Billing', type: 'select', options: ['Headline', 'Co-headline', 'Special guest', 'Support', 'Festival slot'] },
      { key: 'support_acts', label: 'Support acts' },
      { key: 'announce_date', label: 'Announce date', type: 'date' },
      { key: 'on_sale_date', label: 'On-sale date', type: 'date' },
    ]},
    { title: 'Venue', fields: [
      { key: 'venue_name', label: 'Venue' },
      { key: 'venue_address', label: 'Address' },
      { key: 'venue_city', label: 'City' },
      { key: 'venue_state', label: 'State' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'ages', label: 'Ages', type: 'select', options: ['All ages', '18+', '21+'] },
      { key: 'ticket_prices', label: 'Ticket prices' },
    ]},
    { title: 'Deal', fields: [
      { key: 'deal_type', label: 'Deal type', type: 'select', options: ['Flat guarantee', 'Guarantee vs. % of net', 'Guarantee plus % of net', 'Percentage of gross', 'Door deal'] },
      { key: 'guarantee', label: 'Guarantee ($)', type: 'money' },
      { key: 'percentage', label: 'Back-end %', type: 'number' },
      { key: 'deposit_amount', label: 'Deposit ($)', type: 'money' },
      { key: 'deposit_due', label: 'Deposit due', type: 'date' },
      { key: 'balance_terms', label: 'Balance terms' },
      { key: 'deal_notes', label: 'Deal notes (break point, bonuses, expenses)', type: 'textarea', wide: true },
    ]},
    { title: 'Provided by Promoter', fields: [
      { key: 'production_provided', label: 'Sound / lights / backline', type: 'textarea' },
      { key: 'hospitality_buyout', label: 'Hospitality / buyout', type: 'textarea' },
      { key: 'lodging', label: 'Lodging', type: 'textarea' },
      { key: 'ground_transport', label: 'Ground transport', type: 'textarea' },
      { key: 'merch_terms', label: 'Merch terms' },
      { key: 'radius_clause', label: 'Radius clause' },
    ]},
    { title: 'Terms', fields: [
      { key: 'offer_expires', label: 'Offer expires', type: 'date' },
      { key: 'additional_terms', label: 'Additional terms (printed on the offer sheet)', type: 'textarea', wide: true },
      { key: 'internal_notes', label: 'Internal notes (never printed)', type: 'textarea', wide: true, internal: true },
    ]},
  ];

  const ADVANCE_SECTIONS = [
    { title: 'Contacts', fields: [
      { key: 'promoter_rep_name', label: 'Promoter rep (day of)' },
      { key: 'promoter_rep_phone', label: 'Promoter rep phone', type: 'tel' },
      { key: 'tour_manager_name', label: 'Tour manager' },
      { key: 'tour_manager_phone', label: 'TM phone', type: 'tel' },
      { key: 'tour_manager_email', label: 'TM email', type: 'email' },
      { key: 'production_contact_name', label: 'Venue production contact' },
      { key: 'production_contact_phone', label: 'Production phone', type: 'tel' },
      { key: 'production_contact_email', label: 'Production email', type: 'email' },
    ]},
    { title: 'Schedule', fields: [
      { key: 'load_in_time', label: 'Load in', type: 'time' },
      { key: 'soundcheck_time', label: 'Soundcheck', type: 'time' },
      { key: 'doors_time', label: 'Doors', type: 'time' },
      { key: 'support_set_time', label: 'Support set', type: 'time' },
      { key: 'headliner_set_time', label: 'Headliner set', type: 'time' },
      { key: 'curfew', label: 'Curfew', type: 'time' },
      { key: 'schedule_notes', label: 'Schedule notes', type: 'textarea', wide: true },
    ]},
    { title: 'Arrival & Parking', fields: [
      { key: 'party_size', label: 'Party size', type: 'number' },
      { key: 'vehicles', label: 'Vehicles (bus / trailer / vans)' },
      { key: 'parking_notes', label: 'Parking & load-in directions', type: 'textarea', wide: true },
    ]},
    { title: 'Hotel & Travel', fields: [
      { key: 'hotel_name', label: 'Hotel' },
      { key: 'hotel_address', label: 'Hotel address' },
      { key: 'hotel_rooms', label: 'Rooms' },
      { key: 'hotel_confirmation', label: 'Confirmation #' },
      { key: 'hotel_checkin', label: 'Check-in / out' },
      { key: 'ground_transport', label: 'Ground transport / airport runs', type: 'textarea', wide: true },
    ]},
    { title: 'Production', fields: [
      { key: 'stage_dimensions', label: 'Stage dimensions' },
      { key: 'power', label: 'Power' },
      { key: 'sound', label: 'Sound', type: 'textarea' },
      { key: 'lights', label: 'Lights', type: 'textarea' },
      { key: 'backline', label: 'Backline', type: 'textarea' },
      { key: 'video', label: 'Video / LED', type: 'textarea' },
    ]},
    { title: 'Hospitality', fields: [
      { key: 'dressing_rooms', label: 'Dressing rooms' },
      { key: 'catering', label: 'Catering / meals', type: 'textarea' },
      { key: 'hospitality_notes', label: 'Rider hospitality notes', type: 'textarea' },
    ]},
    { title: 'Merch, Guests & Settlement', fields: [
      { key: 'merch_seller', label: 'Merch seller', type: 'select', options: ['Artist sells', 'Venue sells', 'Promoter sells'] },
      { key: 'merch_split', label: 'Merch split (soft / hard)' },
      { key: 'merch_contact', label: 'Merch contact' },
      { key: 'guest_list', label: 'Guest list / comps' },
      { key: 'settlement_contact', label: 'Settlement contact' },
      { key: 'payment_method', label: 'Payment method', type: 'select', options: ['Check', 'Wire', 'ACH', 'Cash', 'Company check'] },
      { key: 'wifi_network', label: 'WiFi network' },
      { key: 'wifi_password', label: 'WiFi password' },
      { key: 'advance_notes', label: 'Other notes', type: 'textarea', wide: true },
    ]},
  ];

  const STATUSES = ['draft', 'sent', 'accepted', 'declined', 'cancelled', 'completed'];

  const DOC_KINDS = {
    contract: 'Contract',
    rider_technical: 'Technical rider',
    rider_hospitality: 'Hospitality rider',
    stage_plot: 'Stage plot / input list',
    other: 'Other',
  };

  const flat = (sections) => sections.flatMap(s => s.fields);
  const api = {
    OFFER_SECTIONS, ADVANCE_SECTIONS, STATUSES, DOC_KINDS,
    OFFER_FIELDS: flat(OFFER_SECTIONS),
    ADVANCE_FIELDS: flat(ADVANCE_SECTIONS),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PF = api;
})(typeof window !== 'undefined' ? window : this);
