// DARK STORE BLITZ - the PRACTICE orders, crises and sales figures.
// This file is in the project (and on GitHub), so anybody can read it. Use it for practice and rehearsals only.
// The real competition orders live in rounds.secret.js (never uploaded) or in the ROUNDS_B64 setting on Render:
// when one of those is there, the server plays it instead of this file. See orders.js and tools/secret-orders.js.
'use strict';

const LAYOUT_MINUTES = 30;     // length of Round 1

// Units sold per hour, by product number. Shown to players only if the organiser presses "Show sales per hour".
const SOLD = { 1: 120, 2: 110, 3: 95, 4: 85, 5: 80, 6: 75, 7: 60, 8: 55, 9: 45, 10: 40, 11: 38, 12: 35, 13: 25, 14: 20, 15: 18, 16: 15, 17: 12, 18: 10, 19: 8, 20: 5, 21: 4, 22: 3, 23: 2, 24: 2 };

// stage: 2 = live rush hour, 3 = surprise disruptions. secs = time limit.
const ROUNDS = [
  { id: 'o1', stage: 2, label: 'Order 1', title: 'Breakfast Rush', items: [1, 3, 6], secs: 60 },
  { id: 'o2', stage: 2, label: 'Order 2', title: 'Midnight Munchies', items: [2, 4, 8, 11], secs: 60 },
  { id: 'o3', stage: 2, label: 'Order 3', title: 'Monthly Grocery', items: [9, 7, 14, 5], secs: 60 },
  { id: 'o4', stage: 2, label: 'Order 4', title: 'Cleaning Day', items: [13, 16, 10, 14], secs: 60 },
  { id: 'o5', stage: 2, label: 'Order 5', title: 'Cold Chain', items: [15, 17, 24, 1], secs: 60 },
  { id: 'o6', stage: 2, label: 'Order 6', title: 'Office Snack', items: [12, 18, 23, 19], secs: 60 },
  { id: 'o7', stage: 2, label: 'Order 7', title: 'Emergency', items: [21, 22, 10, 1], secs: 60 },
  { id: 'o8', stage: 2, label: 'Order 8', title: 'Party Rush', items: [4, 8, 1, 12, 15], secs: 60 },
  { id: 'o9', stage: 2, label: 'Order 9', title: 'Heavy & Fragile', items: [9, 20, 6, 3, 7], secs: 60 },
  { id: 'o10', stage: 2, label: 'Order 10', title: 'Gourmet', items: [20, 24, 2, 18, 23], secs: 60 },

  { id: 'c1a', stage: 3, label: 'Oil spill 1', title: 'Monthly Grocery, again', items: [9, 7, 14, 5], oneWay: true, secs: 60,
    crisis: 'Oil spill! Aisle 6 is one-way: enter at B6, walk down to I6. Nobody walks back up it.' },
  { id: 'c1b', stage: 3, label: 'Oil spill 2', title: 'Office Snack, again', items: [12, 18, 23, 19], oneWay: true, secs: 60,
    crisis: 'Oil spill! Aisle 6 is one-way: enter at B6, walk down to I6. Nobody walks back up it.' },
  { id: 'c2a', stage: 3, label: 'Pallet crash 1', title: 'Breakfast Rush, again', items: [1, 3, 6, 2], blocked: ['B4', 'B5'], secs: 60,
    crisis: 'A pallet fell over! Squares B4 and B5 are blocked. Walk around.' },
  { id: 'c2b', stage: 3, label: 'Pallet crash 2', title: 'Party Rush, again', items: [4, 8, 1, 12, 15], blocked: ['B4', 'B5', 'B7', 'B8'], secs: 60,
    crisis: 'More pallets down! B4, B5, B7 and B8 are all blocked.' },
  { id: 'c3', stage: 3, label: 'Double drop', title: 'Two orders at once', double: true, a: [1, 9, 7, 12], b: [2, 4, 8, 6], secs: 60,
    crisis: 'Two orders dropped together. Two separate trips, or one trip with a heavy cart (meters x 1.25)?' },
  { id: 'fin', stage: 3, label: 'Final boss', title: 'Festival Rush', items: [1, 2, 6, 9, 15, 13], oneWay: true, blocked: ['B4', 'B5'], mult: 2, secs: 60,
    crisis: 'Everything at once: oil spill in aisle 6 AND pallets on B4 and B5. This order is worth DOUBLE points.' }
];

module.exports = { LAYOUT_MINUTES, SOLD, ROUNDS };
