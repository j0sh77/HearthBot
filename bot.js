var Discord = require('discord.io');
var logger = require('winston');
var auth = require('./auth');
var config = require('./config');
var deckstrings = require('deckstrings');
var fetch = require('node-fetch');
fetch.Promise = require('bluebird');

logger.level = 'debug';
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    colorize: true
});

var bot = new Discord.Client({
   token: auth.TOKEN,
   autorun: true
});

bot.on('ready', function (evt) {
    logger.info('Connected');
});

// reconnect
bot.on('disconnect', function(erMsg, code) {
    logger.info('----- Bot disconnected from Discord with code ' + code + 'for reason: ' + erMsg + ' -----');
    bot.connect();
});

bot.on('message', function (user, userID, channelID, message, evt) {
	// check if we are allowed to post here and this isn't a bot message
	if (
		config.DEV && config.CHANNEL_DEV.indexOf(channelID) < 0 ||
		userID == bot.id ||
		(
			!config.DEV &&
			(
				config.CHANNEL_WHITELIST.length && config.CHANNEL_WHITELIST.indexOf(channelID) < 0 ||
				config.CHANNEL_BLACKLIST.length && config.CHANNEL_BLACKLIST.indexOf(channelID) >= 0
			)
		)

	) {
		return;
	};

	// check for [[card]]
	if (config.ALLOW_CARDS) {
		var cards = message.match(/\[\[(.*?)\]\]/g);
		if (cards && cards.length) {
			// limit number of cards
			cardsSent = 0

			cards.forEach(function(card) {
				name = card.replace(/\[/g, '').replace(/\]/g, '');
				collectible = config.COLLECTIBLE_ONLY ? "&collectible=1" : "";
				showDetails = config.PRINT_CARD_DETAILS;

				if (name.length < config.CARD_LENGTH_MIN || cardsSent >= config.CARD_LIMIT) {
					return;
				}

				// show only card
				if (config.ALLOW_CARD_ONLY && name.slice(-1 * config.CARD_ONLY_SUFFIX.length) == config.CARD_ONLY_SUFFIX) {
					showDetails = false;
					name = name.slice(0, -1 * config.CARD_ONLY_SUFFIX.length);
				}

				var searchType = showDetails ? '&t=detail' : '&t=card' + (!showDetails ? '&conly' : '');
				var details = "&key=" + auth.KEY + "&u=" + user + "&uid=" + userID + "&cid=" + channelID;

				if (config.DEV) {
					details += '&dev';
				}

				// get card data
				fetch(config.API_URL + "name=" + name + collectible + searchType + details, {method: 'GET'})
				.then(function(response) {
					return response.json();
				})
				.then(function(card) {
					if (!("error" in card)) {
						// if card length is 1, only the image exists
						if (Object.keys(card).length > 1) {
							embed = formatCard(card);
						} else {
							embed = {
								"color": config.CLASSES['Neutral']['color'],
								"image": {
									"url": card['img']
								}
							};
						}

						bot.sendMessage({
							to: channelID,
							embed: embed
						});
					}
				});

				cardsSent++;
			});
		}
	}

	if (config.ALLOW_DECKS) {
		var decks = message.match(/AAE((.*?)(=|$|\s))+/g);
		var deckNameMatch = message.match(/### (.*?)+/g);

		if (decks && decks.length) {
			// limit number of decks
			decksSent = 0;

			decks.forEach(function(deck) {
				if (decksSent > config.DECK_LIMIT) {
					return;
				}

				var deckName = deckNameMatch && deckNameMatch.length ? deckNameMatch[0].substring(4) : null;

				try {
					decoded = deckstrings.decode(deck);
				} catch (err){
					logger.error("Error decoding deck string: '" + deck + "'");
					return;
				}

				// get list of card ids
				ids = [];
				decoded['cards'].forEach(function(card) {
					ids.push(card[0]);
				});
				decoded['heroes'].forEach(function(hero) {
					ids.push(hero);
				});

				// get card data
				fetch(config.API_URL + "id=" + ids.join(',') + "&key=" + auth.KEY, {method: 'GET'})
				.then(function(response) {
					return response.json();
				})
				.then(function(cardData) {
					userInfo = "&u=" + user + "&uid=" + userID + "&cid=" + channelID;
					if (!("error" in cardData)) {
						var deckFormat = formatDeck(deck, decoded, cardData, deck, deckName, user, userID, channelID);

						bot.sendMessage({
							to: channelID,
							message: deckFormat['message'],
							embed: deckFormat['embed'],
						});
					} else {
						logger.error(cardData['error']);
					}
				});

				decksSent++;
			});
		}
	}
});

function formatCard(card) {
	cardText = '';

	if (card['text']) {
		cardText = card['text'].trim().replace(/\[x\]/g, "").replace(/[ ]+/g, " ").replace(/\\n|_/g, " ").replace(/\$([0-9]+)/g, "$1").replace(/\(([0-9]+)\)/g, "$1").trim();
	}

	// bold keywords
	config.KEYWORDS.forEach(function(keyword) {
		if (cardText.indexOf(keyword) >= 0)
		{
			if (keyword == "Recruit") {
				var regex = new RegExp("^(?!Silver Hand )(Recruit[\.|:]?)", "g");
			} else {
				var regex = new RegExp("(" + keyword + "[\.|:]?)", "g");
			}
			cardText = cardText.replace(regex, "**$1**");
		}
	});

	// get details
	var type = "**Type:** " + card['type'] + "\n";
	var classt = "**Class:** " + card['class'] + "\n";
	var rarity = "**Rarity:** " + card['rarity'];

	// get stats
	var attackEmoji = card['type'] == 'Weapon' ? config.WEAPON_ATTACK_EMOJI : config.ATTACK_EMOJI;
	var healthEmoji = card['type'] == 'Weapon' ? config.WEAPON_HEALTH_EMOJI : config.HEALTH_EMOJI;
	var attack = 'attack' in card && card['attack'] != null ? (attackEmoji + ' **' + card['attack'] + '**  ') : '';
	var health = 'health' in card && card['health'] != null ? (healthEmoji + ' **' + card['health'] + '**  ') : '';
	var stats = (attack != '' || health != '') ? (attack + health + "\n\n") : "";

	// other info
	var text = cardText != '' ? ("\n\n*" + cardText + "*") : '';
	var set = "Set: " + card['set'];

	return {
		"author": {
			"name": card['name'],
			"icon_url": "https://jjdev.io/hearthbot/img/mana-" + card['cost'] + ".png"
		},
		"color": config.RARITIES[card['rarity']]['color'],
		"description": stats + type + classt + rarity + text,
		"footer": {
			"text": set
		},
		"thumbnail": {
			"url": card['img']
		}
	}
}

function formatDeck(deckCode, deckData, cardData, deck, deckName, user, userID, channelID) {
	var blankField = {"value": ""};

	var classCards = [];
	var neutralCards = [];
	var dust = 0;
	var classes = [];

	deckData['heroes'].forEach(function(hero) {
		classes.push(cardData[hero]['class']);
	});

	var deckClass = classes.join(',');

	deckData['cards'].forEach(function(card) {
		cardData[card[0]]['count'] = card[1];

		if (cardData[card[0]]['class'] != 'Neutral') {
			classCards.push(cardData[card[0]])
		} else {
			neutralCards.push(cardData[card[0]])
		}

		rarity = cardData[card[0]]['rarity'];
		dust += config.RARITIES[rarity]['dust'] * card[1];
	});

	var classCardsText = [];
	var neutralCardsText = [];

	classCards.sort(function(a, b) {
	    return a['cost'] - b['cost'];
	});
	neutralCards.sort(function(a, b) {
	    return a['cost'] - b['cost'];
	});

	classCards.forEach(function(card) {
		classCardsText.push(formatDeckCard(card));
	});
	neutralCards.forEach(function(card) {
		neutralCardsText.push(formatDeckCard(card));
	});

	var format = deckData['format'] == 1 ? "Wild" : "Standard";

	var userInfo = "&u=" + user + "&uid=" + userID + "&cid=" + channelID;

	// log deck in db (will probably replace with parsing on api side eventually)
	var url = config.API_URL + userInfo +
		"&deck=" + deck +
		"&f=" + format +
		"&c=" + deckClass +
		"&d=" + dust +
		"&key=" + auth.KEY;

	fetch(url, {method: 'GET'})

	var fields = [
		{
			"name": "Class Cards",
			"value": classCards.length ? classCardsText.join('\n') : ":no_entry:",
			"inline": true
		},
		{
			"name": "Neutral Cards",
			"value": neutralCards.length ? neutralCardsText.join('\n') : ":no_entry:",
			"inline": true
		},
	];

	var embed = {
		"author": {
			"name": deckClass + " (" + format + ")",
			"icon_url": (classes.length == 1 ? config.CLASSES[deckClass]['icon'] : "")
		},
		"title": "View Deckbuilder",
		"url": "https://playhearthstone.com/en-us/deckbuilder?deckcode=" + deckCode,
		"color": (classes.length == 1 ? config.CLASSES[deckClass]['color'] : config.CLASSES['Neutral']['color']),
		"fields": fields,
		"footer": {
			"icon_url": "https://cdn.discordapp.com/emojis/230175397243781121.png",
			"text": "" + dust
		}
	};

	var message = `<@${userID}>'s ${deckName ? `**${deckName}** ` : ''}deck:`;

	return {
		"embed": embed,
		"message": message,
	};
}

function formatDeckCard(card) {
	var cost = card['cost'] in config.MANA_EMOJI ? config.MANA_EMOJI[card['cost']] : card['cost']
	var rarity = config.RARITIES[card['rarity']]['emoji'];
	return card['count'] + "x " + card['name'];
}
