const router = require("express").Router();
const { GRUNDMATERIAL, PRODUKTART } = require("../../utils/constants");
const { resolveAusschussGrund } = require("../../services/schmuckstueckService");

// Reihenfolge ist relevant: feste Pfade (/foto, /filter-options, …) vor /:artikelnummer
router.use(require("./foto"));
router.use(require("./bulk"));
router.use(require("./liste"));
router.use(require("./anlegen"));
router.use(require("./bearbeiten"));

module.exports = router;
module.exports.resolveAusschussGrund = resolveAusschussGrund;
module.exports.GRUNDMATERIAL = GRUNDMATERIAL;
module.exports.PRODUKTART = PRODUKTART;
