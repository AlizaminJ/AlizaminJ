import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const username = 'AlizaminJ';
const token = process.env.GRAPH_TOKEN;
const escapeXml = (value) =>
    String(value).replace(/[<>&"']/g, (character) => {
        const entities = {
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&apos;',
        };
        return entities[character];
    });

if (!token) {
    throw new Error('Set the GRAPH_TOKEN repository secret before running this workflow.');
}

const today = new Date();
const to = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59),
);
const from = new Date(to);
from.setUTCHours(0, 0, 0, 0);
from.setUTCDate(from.getUTCDate() - 30);

const query = `
    query ActivityGraph($username: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $username) {
            name
            contributionsCollection(from: $from, to: $to) {
                contributionCalendar {
                    weeks {
                        contributionDays {
                            contributionCount
                            date
                        }
                    }
                }
            }
        }
    }
`;

const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        query,
        variables: {
            username,
            from: from.toISOString(),
            to: to.toISOString(),
        },
    }),
});

if (!response.ok) {
    throw new Error(`GitHub GraphQL API returned HTTP ${response.status}.`);
}

const result = await response.json();
if (result.errors?.length) {
    throw new Error(`GitHub GraphQL API error: ${result.errors[0].message}`);
}

const user = result.data?.user;
if (!user) {
    throw new Error(`GitHub user ${username} was not found.`);
}

const fromDate = from.toISOString().slice(0, 10);
const toDate = to.toISOString().slice(0, 10);
const days = user.contributionsCollection.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays)
    .filter((day) => day.date >= fromDate && day.date <= toDate);

if (days.length !== 31) {
    throw new Error(`Expected 31 days of contributions, received ${days.length}.`);
}

const width = 1200;
const height = 380;
const left = 88;
const right = 1155;
const top = 88;
const bottom = 314;
const chartWidth = right - left;
const chartHeight = bottom - top;
const maxContribution = Math.max(1, ...days.map((day) => day.contributionCount));
const tickStep = Math.max(1, Math.ceil(maxContribution / 4));
const chartMax = tickStep * 4;
const points = days.map((day, index) => ({
    x: left + (index / (days.length - 1)) * chartWidth,
    y: bottom - (day.contributionCount / chartMax) * chartHeight,
    ...day,
}));

const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
const areaPath = `${linePath} L ${right} ${bottom} L ${left} ${bottom} Z`;
const yAxis = Array.from({ length: 5 }, (_, index) => {
    const value = tickStep * index;
    const y = bottom - (value / chartMax) * chartHeight;
    return `
        <line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#30363d" />
        <text x="${left - 16}" y="${y + 5}" text-anchor="end" fill="#8b949e" font-size="14">${value}</text>`;
}).join('');
const xAxis = [0, 7, 14, 21, 30]
    .map((index) => {
        const point = points[index];
        const label = new Intl.DateTimeFormat('en', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
        }).format(new Date(`${point.date}T00:00:00Z`));
        return `<text x="${point.x}" y="${bottom + 30}" text-anchor="middle" fill="#8b949e" font-size="14">${label}</text>`;
    })
    .join('');
const circles = points
    .map(
        (point) =>
            `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4" fill="#58a6ff" stroke="#0d1117" stroke-width="2"><title>${point.date}: ${point.contributionCount} contributions</title></circle>`,
    )
    .join('');
const total = days.reduce((sum, day) => sum + day.contributionCount, 0);
const title = escapeXml(`${user.name || username}'s Contribution Graph`);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">${total} GitHub contributions in the last 31 days.</desc>
  <rect width="100%" height="100%" rx="12" fill="#0d1117" />
  <text x="${left}" y="42" fill="#f0f6fc" font-family="Arial, sans-serif" font-size="22" font-weight="600">${title}</text>
  <text x="${right}" y="42" text-anchor="end" fill="#8b949e" font-family="Arial, sans-serif" font-size="14">${total} contributions in the last 31 days</text>
  <g font-family="Arial, sans-serif">${yAxis}${xAxis}</g>
  <path d="${areaPath}" fill="#58a6ff" fill-opacity="0.14" />
  <path d="${linePath}" fill="none" stroke="#58a6ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  ${circles}
</svg>
`;

const outputPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../activity-graph.svg');
await writeFile(outputPath, svg, 'utf8');
console.log(`Wrote the ${days.length}-day activity graph to ${outputPath}.`);