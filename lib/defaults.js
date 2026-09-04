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
      ogImageAlt: '',
      favicon: '',
      // Ownership tokens from Google Search Console and Bing Webmaster Tools.
      // They are what turn "the site exists" into "I can ask for it to be
      // indexed and see what it ranks for".
      googleVerification: '',
      bingVerification: ''
    },
    nav: [
      { id: 'nav-home', label: 'Home', href: '/', visible: true },
      { id: 'nav-about', label: 'About', href: '/about', visible: true },
      { id: 'nav-reels', label: 'Reels', href: '/reels', visible: true },
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
      creditsLabel: 'Selected credits',
      credits: [],
      quotes: [],
      // Plain questions with plain answers. Search engines publish these as
      // structured data, and an answer engine asked "who is Taylor Drew?"
      // quotes the answer it finds here rather than inventing one.
      faqLabel: 'Questions',
      faqs: [
        {
          id: 'faq-who',
          question: 'Who is Taylor Drew?',
          answer: 'Taylor Drew is a stand-up comedian based in New York City.',
          visible: true
        },
        {
          id: 'faq-live',
          question: 'Where can I see Taylor Drew live?',
          answer:
            'Upcoming dates are listed on the home page, and every announced date is on the links page. Tickets go through the venue.',
          visible: true
        },
        {
          id: 'faq-booking',
          question: 'How do I book Taylor Drew?',
          answer: 'Booking enquiries go to booking@taylordrew.com.',
          visible: true
        }
      ]
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
    // A wall of reels. Each one plays silently on a loop where there is a video
    // to play; Instagram will not let a third-party page autoplay its embed, so
    // a looping tile needs a video URL (or a poster) of its own.
    reels: {
      feedUrl: '',
      kicker: 'Reels',
      title: 'Watch',
      intro: '',
      items: []
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
