const express = require('express');
const Parser = require('rss-parser');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

app.use(cors());
app.use(express.json());

// RSS feed sources
const RSS_SOURCES = [

     {
    name: 'Harvard Business Review',
    url: 'http://feeds.harvardbusiness.org/harvardbusiness?format=xml',
    category: 'Business Strategy'
  },
  {
    name: 'CNBC',
    url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    category: 'Markets & Business'
  },
  {
    name: 'Financial Times',
    url: 'https://www.ft.com/rss/home',
    category: 'Global Finance'
  },
  {
    name: 'Bloomberg',
    url: 'https://feeds.bloomberg.com/markets/news.rss',
    category: 'Markets'
  }
];

// Cagit add .che for combined feed
let cachedFeed = null;
let lastUpdate = null;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Function to fetch and parse a single RSS feed
async function fetchFeed(source) {
  try {
    console.log(`Fetching ${source.name}...`);
    const feed = await parser.parseURL(source.url);
    
    return feed.items.map(item => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate || item.isoDate,
      description: item.contentSnippet || item.content || '',
      source: source.name,
      category: source.category,
      guid: item.guid || item.link
    }));
  } catch (error) {
    console.error(`Error fetching ${source.name}:`, error.message);
    return [];
  }
}

// Function to combine all RSS feeds
async function combinedRSSFeed() {
  try {
    console.log('Starting RSS feed combination...');
    
    // Fetch all feeds concurrently
    const feedPromises = RSS_SOURCES.map(source => fetchFeed(source));
    const feedResults = await Promise.allSettled(feedPromises);
    
    // Combine successful feeds
    let allItems = [];
    feedResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allItems = allItems.concat(result.value);
      } else {
        console.error(`Failed to fetch ${RSS_SOURCES[index].name}`);
      }
    });
    
    // Sort by publication date (newest first)
    allItems.sort((a, b) => {
      const dateA = new Date(a.pubDate || 0);
      const dateB = new Date(b.pubDate || 0);
      return dateB - dateA;
    });
    
    // Remove duplicates based on title similarity
    const uniqueItems = [];
    const seenTitles = new Set();
    
    allItems.forEach(item => {
      const normalizedTitle = item.title.toLowerCase().replace(/[^\w\s]/g, '');
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle);
        uniqueItems.push(item);
      }
    });
    
    console.log(`Combined ${uniqueItems.length} unique items from ${RSS_SOURCES.length} sources`);
    return uniqueItems.slice(0, 100); // Limit to 100 most recent items
    
  } catch (error) {
    console.error('Error combining RSS feeds:', error);
    return [];
  }
}

// Function to generate RSS XML
function generateRSSXML(items) {
  const now = new Date().toUTCString();
  
  let rssItems = items.map(item => {
    const pubDate = item.pubDate ? new Date(item.pubDate).toUTCString() : now;
    const description = escapeXML(item.description.substring(0, 500) + (item.description.length > 500 ? '...' : ''));
    
    return `
    <item>
      <title>${escapeXML(item.title)}</title>
      <link>${escapeXML(item.link)}</link>
      <description>${description}</description>
      <pubDate>${pubDate}</pubDate>
      <source>${escapeXML(item.source)}</source>
      <category>${escapeXML(item.category)}</category>
      <guid>${escapeXML(item.guid)}</guid>
    </item>`;
  }).join('');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Financial News Hub - Combined Feed</title>
    <link>https://your-domain.com/rss</link>
    <description>Combined RSS feed from Harvard Business Review, Wall Street Journal, CNBC, Financial Times, and Bloomberg</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>15</ttl>
    ${rssItems}
  </channel>
</rss>`;
}

// Utility function to escape XML characters
function escapeXML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Update cache function
async function updateCache() {
  console.log('Updating RSS cache...');
  const items = await combinedRSSFeed();
  cachedFeed = generateRSSXML(items);
  lastUpdate = new Date();
  console.log('Cache updated successfully');
}

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Financial News RSS Hub',
    endpoints: {
      rss: '/rss',
      json: '/json',
      status: '/status'
    },
    sources: RSS_SOURCES.map(s => s.name)
  });
});

app.get('/rss', async (req, res) => {
  try {
    // Check if cache needs update
    if (!cachedFeed || !lastUpdate || (Date.now() - lastUpdate.getTime()) > CACHE_DURATION) {
      await updateCache();
    }
    
    res.set('Content-Type', 'application/rss+xml');
    res.send(cachedFeed);
  } catch (error) {
    console.error('Error serving RSS:', error);
    res.status(500).json({ error: 'Failed to generate RSS feed' });
  }
});

app.get('/json', async (req, res) => {
  try {
    const items = await combinedRSSFeed();
    res.json({
      title: 'Financial News Hub - Combined Feed',
      description: 'Combined feed from top financial news sources',
      items: items,
      lastUpdated: new Date().toISOString(),
      sources: RSS_SOURCES.map(s => s.name)
    });
  } catch (error) {
    console.error('Error serving JSON:', error);
    res.status(500).json({ error: 'Failed to generate JSON feed' });
  }
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    lastUpdate: lastUpdate,
    cacheAge: lastUpdate ? Date.now() - lastUpdate.getTime() : null,
    sources: RSS_SOURCES.length,
    uptime: process.uptime()
  });
});

// Schedule cache updates every 15 minutes
cron.schedule('*/15 * * * *', () => {
  updateCache();
});

// Initial cache update
updateCache();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RSS Hub server running on port ${PORT}`);
  console.log(`RSS feed available at: http://localhost:${PORT}/rss`);
  console.log(`JSON feed available at: http://localhost:${PORT}/json`);
});

module.exports = app;