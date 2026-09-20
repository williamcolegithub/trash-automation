// Copy to config.js and fill in your own details. config.js is not committed.

const CONTACT = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
};

// days: which scheduled weekdays this address is submitted on (Mon=1 ... Sun=0)
const SUBMISSIONS = [
  {
    searchText: '100 N Example',
    suggestion: /100 N EXAMPLE ST, Baltimore City/i,
    days: [1, 4], // Mon + Thu
    oddOrEven: 'Odd',
    over100lb: 'No',
    obstructingTraffic: 'No',
    dumpedFromVehicle: 'No',
    description: 'Household trash in the alley. Trash is on the odd side of the street and is not blocking the road. Under 100 pounds of debris.',
  },
  // Addresses missing from the 311 address table can be selected by clicking
  // the map instead. See mapTarget handling in submit.js.
];

module.exports = { CONTACT, SUBMISSIONS };
