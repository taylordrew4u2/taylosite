'use strict';

/**
 * The shape of the whole site. Everything a visitor sees is in here, and
 * everything in here is editable from /admin.
 */
function defaultSite() {
  return {
    version: 1,
    brand: {
      name: 'Taylor Drew',
      logoText: 'TAYLOR DREW',
      location: 'New York City',
      email: 'booking@taylordrew.com',
      accentLabel: 'Stand-up comedian'
    },
    seo: {
      title: 'Taylor Drew — Stand-up comedian, New York City',
      description: 'Taylor Drew is a stand-up comedian based in New York City. Tour dates, links and booking.',
      ogImage: '',
      favicon: ''
    },
    nav: [
      { id: 'nav-home', label: 'Home', href: '/', visible: true },
      { id: 'nav-about', label: 'About', href: '/about', visible: true },
      { id: 'nav-links', label: 'Links', href: '/links', visible: true }
    ],
    home: {
      kicker: 'Stand-up comedian',
      headline: 'Taylor Drew',
      subhead: 'Stand-up comedian. New York City.',
      photo: '',
      photoAlt: 'Taylor Drew',
      photoPlaceholder: 'Add a photo in admin',
      primaryCta: { label: 'Links', href: '/links', visible: true },
      secondaryCta: { label: 'About', href: '/about', visible: true },
      upcoming: {
        visible: true,
        label: 'Upcoming',
        emptyText: 'Coming soon',
        maxItems: 3,
        allShowsLabel: 'All dates'
      }
    },
    about: {
      kicker: 'About',
      title: 'Taylor Drew',
      photo: '',
      photoAlt: 'Taylor Drew',
      body: [
        'Taylor Drew is a stand-up comedian based in New York City.',
        'Write the real bio in the admin panel — every paragraph on this page is editable, and you can add as many as you want.'
      ],
      facts: [
        { id: 'fact-base', label: 'Based in', value: 'New York City' },
        { id: 'fact-booking', label: 'Booking', value: 'booking@taylordrew.com' }
      ],
      quotes: []
    },
    links: {
      kicker: 'Links',
      title: 'Everything in one place',
      intro: 'Tickets, clips, socials and the mailing list.',
      items: [
        {
          id: 'link-instagram',
          label: 'Instagram',
          sublabel: 'Clips and day-to-day',
          url: 'https://instagram.com/',
          visible: true,
          featured: true,
          clicks: 0
        },
        {
          id: 'link-tiktok',
          label: 'TikTok',
          sublabel: 'Crowd work',
          url: 'https://tiktok.com/',
          visible: true,
          featured: false,
          clicks: 0
        },
        {
          id: 'link-youtube',
          label: 'YouTube',
          sublabel: 'Full sets',
          url: 'https://youtube.com/',
          visible: true,
          featured: false,
          clicks: 0
        },
        {
          id: 'link-email',
          label: 'Booking',
          sublabel: 'booking@taylordrew.com',
          url: 'mailto:booking@taylordrew.com',
          visible: true,
          featured: false,
          clicks: 0
        }
      ]
    },
    shows: [],
    footer: {
      left: 'Taylor Drew · New York City',
      right: 'booking@taylordrew.com',
      rightHref: 'mailto:booking@taylordrew.com',
      note: ''
    },
    themes: {
      default: 'A',
      options: [
        {
          id: 'A',
          name: 'Red',
          bg: '#0b0b0b',
          surface: '#141414',
          text: '#ffffff',
          muted: '#8f8f8f',
          accent: '#ef4123',
          accentText: '#ffffff',
          line: '#ffffff'
        },
        {
          id: 'B',
          name: 'Mono',
          bg: '#0b0b0b',
          surface: '#141414',
          text: '#ffffff',
          muted: '#8f8f8f',
          accent: '#ffffff',
          accentText: '#000000',
          line: '#ffffff'
        },
        {
          id: 'C',
          name: 'Paper',
          bg: '#f2f0eb',
          surface: '#e6e3dc',
          text: '#111111',
          muted: '#5f5c56',
          accent: '#1f4bd8',
          accentText: '#ffffff',
          line: '#111111'
        }
      ]
    },
    auth: {
      hash: '',
      salt: '',
      updatedAt: null
    },
    meta: {
      updatedAt: null
    }
  };
}

module.exports = { defaultSite };
