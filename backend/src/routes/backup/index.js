const router = require("express").Router();

router.use(require("./json"));
router.use(require("./sql"));
router.use(require("./fotos"));
router.use(require("./import"));

module.exports = router;
