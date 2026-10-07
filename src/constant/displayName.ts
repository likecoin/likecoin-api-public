// Word pools for the display name auto-generated at signup.
// The HK and TW place lists live in displayNamePlaces/*.json so non-developers can edit them.
import placesHK from './displayNamePlaces/hk.json';
import placesTW from './displayNamePlaces/tw.json';

// Hong Kong and Taiwan place names, each paired as `<place>的<nature>`.
export const DISPLAY_NAME_PLACES_HK: readonly string[] = placesHK;
export const DISPLAY_NAME_PLACES_TW: readonly string[] = placesTW;

// Both lists combined; 白沙灣 and 金山 are in each, hence the Set.
export const DISPLAY_NAME_PLACES_ZH = Array.from(
  new Set([...DISPLAY_NAME_PLACES_HK, ...DISPLAY_NAME_PLACES_TW]),
);

// International city names, paired as `<city>'s <nature>`.
export const DISPLAY_NAME_PLACES_EN = [
  'Tokyo', 'Kyoto', 'Osaka', 'Nagoya', 'Kobe', 'Fukuoka', 'Sapporo', 'Sendai',
  'Hiroshima', 'Nara', 'Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon', 'Gwangju',
  'Suwon', 'Ulsan', 'Jeju', 'Pohang', 'Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen',
  'Chengdu', 'Hangzhou', 'Wuhan', 'Nanjing', 'Tianjin', 'Xi\'an', 'Hong Kong', 'Taipei',
  'Tainan', 'Taichung', 'Kaohsiung', 'Hsinchu', 'Keelung', 'Chiayi', 'Hualien',
  'Taitung', 'Yilan', 'Bangkok', 'Phuket', 'Chiang Mai', 'Pattaya', 'Hanoi', 'Da Nang',
  'Hue', 'Saigon', 'Can Tho', 'Nha Trang', 'Jakarta', 'Surabaya', 'Bandung', 'Medan',
  'Semarang', 'Makassar', 'Denpasar', 'Manila', 'Cebu', 'Davao', 'Singapore',
  'KualaLumpu', 'Penang', 'Ipoh', 'Malacca', 'Kuching', 'Yangon', 'Mandalay',
  'Vientiane', 'Phnom Penh', 'Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Kolkata',
  'Hyderabad', 'Pune', 'Ahmedabad', 'Jaipur', 'Surat', 'Dhaka', 'Chittagong', 'Colombo',
  'Kandy', 'Galle', 'Kathmandu', 'Pokhara', 'Thimphu', 'Male', 'Karachi', 'Lahore',
  'Islamabad', 'Dubai', 'Abu Dhabi', 'Doha', 'Riyadh', 'Jeddah', 'Mecca', 'Medina',
  'Muscat', 'London', 'Manchester', 'Liverpool', 'Birmingham', 'Leeds', 'Bristol',
  'Sheffield', 'Newcastle', 'Oxford', 'Cambridge', 'Edinburgh', 'Glasgow', 'Aberdeen',
  'Dundee', 'Belfast', 'Dublin', 'Cork', 'Galway', 'Limerick', 'Cardiff', 'Paris',
  'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Montpellie',
  'Bordeaux', 'Lille', 'Rennes', 'Reims', 'Toulon', 'Grenoble', 'Dijon', 'Angers',
  'Nimes', 'Brest', 'Le Mans', 'Amiens', 'Berlin', 'Hamburg', 'Munich', 'Cologne',
  'Frankfurt', 'Stuttgart', 'Dusseldorf', 'Leipzig', 'Dortmund', 'Essen', 'Bremen',
  'Dresden', 'Hannover', 'Nuremberg', 'Duisburg', 'Bochum', 'Wuppertal', 'Bielefeld',
  'Bonn', 'Munster', 'Rome', 'Milan', 'Naples', 'Turin', 'Palermo', 'Genoa', 'Bologna',
  'Florence', 'Bari', 'Catania', 'Venice', 'Verona', 'Messina', 'Padua', 'Trieste',
  'Brescia', 'Parma', 'Taranto', 'Prato', 'Modena', 'Madrid', 'Barcelona', 'Valencia',
  'Seville', 'Zaragoza', 'Malaga', 'Murcia', 'Palma', 'Bilbao', 'Alicante', 'Cordoba',
  'Valladolid', 'Vigo', 'Gijon', 'Granada', 'Vitoria', 'Elche', 'Oviedo', 'Badalona',
  'Cartagena', 'Lisbon', 'Porto', 'Braga', 'Coimbra', 'Funchal', 'Vienna', 'Graz',
  'Linz', 'Salzburg', 'Innsbruck', 'Zurich', 'Geneva', 'Basel', 'Lausanne', 'Bern',
  'Lucerne', 'Lugano', 'Brussels', 'Antwerp', 'Ghent', 'Amsterdam', 'Rotterdam',
  'The Hague', 'Utrecht', 'Eindhoven', 'Stockholm', 'Gothenburg', 'Malmo', 'Uppsala',
  'Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Copenhagen', 'Aarhus', 'Odense',
  'Aalborg', 'Helsinki', 'Espoo', 'Tampere', 'Vantaa', 'Oulu', 'Turku', 'Reykjavik',
  'Warsaw', 'Krakow', 'Lodz', 'Wroclaw', 'Poznan', 'Gdansk', 'New York', 'LosAngeles',
  'Chicago', 'Houston', 'Phoenix', 'Dallas', 'Austin', 'San Jose', 'Columbus',
  'Charlotte', 'Seattle', 'Denver', 'Boston', 'Detroit', 'Nashville', 'Portland',
  'Memphis', 'Las Vegas', 'Baltimore', 'Milwaukee', 'Atlanta', 'Miami', 'Raleigh',
  'Omaha', 'Oakland', 'Tulsa', 'Cleveland', 'Wichita', 'Arlington', 'Toronto',
  'Montreal', 'Calgary', 'Ottawa', 'Edmonton', 'Winnipeg', 'Vancouver', 'Brampton',
  'Hamilton', 'Quebec', 'Surrey', 'Laval', 'Halifax', 'Markham', 'Vaughan', 'Gatineau',
  'Windsor', 'Kitchener', 'Burnaby', 'MexicoCity', 'Tijuana', 'Ecatepec', 'Leon',
  'Puebla', 'Juarez', 'Guadalajar', 'Zapopan', 'Monterrey', 'Merida', 'Cancun',
  'Toluca', 'Chihuahua', 'Saltillo', 'Hermosillo', 'Culiacan', 'Veracruz', 'Irapuato',
  'Mazatlan', 'Oaxaca', 'Bogota', 'Medellin', 'Cali', 'Barranquil', 'Lima', 'Arequipa',
  'Trujillo', 'Chiclayo', 'Cusco', 'Santiago', 'Valparaiso', 'Concepcion', 'La Serena',
  'Antofagas', 'BuenosAire', 'Rosario', 'Mendoza', 'La Plata', 'Cairo', 'Alexandria',
  'Giza', 'Luxor', 'Aswan', 'Lagos', 'Kano', 'Ibadan', 'Abuja', 'Accra', 'Kumasi',
  'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'AddisAbaba', 'Dire Dawa', 'Casablanca',
  'Rabat', 'Fez', 'Marrakesh', 'Tangier', 'Agadir', 'Tunis', 'Sfax', 'Sousse',
  'Algiers', 'Oran', 'Constantin', 'Dakar', 'Luanda', 'Maputo', 'Harare', 'Bulawayo',
  'Lusaka', 'Kigali', 'Kampala', 'DarEsSalam', 'Dodoma', 'Zanzibar', 'Cape Town',
  'Durban', 'Pretoria', 'Gqeberha', 'Bloemfont', 'Sydney', 'Melbourne', 'Brisbane',
  'Perth', 'Adelaide', 'Gold Coast', 'Canberra', 'Hobart', 'Darwin', 'Auckland',
  'Wellington', 'Christchur', 'Tauranga', 'Athens', 'Thessalon', 'Prague', 'Brno',
  'Ostrava',
] as const;

// Animals and nature words for the Chinese pool. Not index-aligned with the
// English pool: the two locales draw independently.
export const DISPLAY_NAME_NATURE_ZH = [
  '獅子', '大象', '長頸鹿', '企鵝', '大熊貓', '藍鯨', '獵豹', '北極熊', '袋鼠', '海豚', '斑馬', '樹懶', '老鷹', '野狼',
  '駱駝', '狐狸', '變色龍', '海龜', '犀牛', '黑猩猩', '浣熊', '刺猬', '水獺', '鴨嘴獸', '穿山甲', '禿鷹', '貓頭鷹',
  '啄木鳥', '火烈鳥', '孔雀', '蜂鳥', '翠鳥', '虎鯨', '抹香鯨', '大白鯊', '魟魚', '海獅', '海象', '儒艮', '章魚',
  '烏賊', '水母', '樹蛙', '蠑螈', '科莫多', '響尾蛇', '眼鏡蛇', '獨角仙', '螢火蟲', '螳螂', '無尾熊', '河馬', '羚羊',
  '馴鹿', '犛牛', '狐獴', '豪豬', '松鼠', '土撥鼠', '負鼠', '食蟻獸', '犰狳', '羊駝', '美洲豹', '雪豹', '鬣狗', '狒狒',
  '長臂猿', '金絲猴', '環尾狐', '鵜鶘', '海鷗', '信天翁', '丹頂鶴', '喜鵲', '烏鴉', '鸚鵡', '麻雀', '燕子', '鸕鶿',
  '鯨鯊', '雙頭鯊', '電鰻', '小丑魚', '海馬', '旗魚', '翻車魚', '飛魚', '寄居蟹', '龍蝦', '珊瑚', '海膽', '海參',
  '鱷魚', '綠鬣蜥', '壁虎', '蟾蜍', '蜻蜓', '蝴蝶', '蜜蜂', '蜜獾', '雲豹', '美洲獅', '棕熊', '黑熊', '馬來熊', '麝牛',
  '瞪羚', '斑鬣狗', '藪貓', '獰貓', '兔猻', '樹袋熊', '針鼴', '袋熊', '袋獾', '狐蝠', '果蝠', '倉鼠', '天竺鼠', '水豚',
  '栗鼠', '海獺', '貂', '鼬', '獾', '獴', '麝香貓', '白鸛', '黑天鵝', '白天鵝', '鴛鴦', '綠頭鴨', '八哥', '畫眉',
  '百靈', '金絲雀', '蒼鷹', '隼', '鴯鶓', '鴕鳥', '奇異鳥', '藍腳鰹', '軍艦鳥', '蝠魟', '獅子魚', '盲鰻', '錦鯉',
  '金魚', '鬥魚', '極光', '彩虹', '日蝕', '月蝕', '閃電', '龍捲風', '地震', '海嘯', '流星雨', '潮汐', '晨霧', '冰雹',
  '暴風雪', '晚霞', '沙塵暴', '水龍捲', '霜凍', '露水', '霧淞', '暴雨', '颱風', '颶風', '乾旱', '雷暴', '寒潮', '熱浪',
  '結冰', '融雪', '雪崩', '山崩', '土石流', '日暈', '月暈', '幻日', '綠閃光', '藍眼淚', '赤潮', '火山煙', '熔岩流',
  '地熱泉', '間歇泉', '落雷', '靜電', '湧浪', '漩渦', '逆溫', '焚風', '季風', '鋒面', '氣旋',
] as const;

// Animals and nature words for the English pool.
export const DISPLAY_NAME_NATURE_EN = [
  'Lion', 'Elephant', 'Giraffe', 'Penguin', 'Panda', 'Whale', 'Cheetah', 'Polar Bear',
  'Kangaroo', 'Dolphin', 'Zebra', 'Sloth', 'Eagle', 'Wolf', 'Camel', 'Fox', 'Chameleon',
  'Turtle', 'Rhino', 'Chimp', 'Raccoon', 'Hedgehog', 'Otter', 'Platypus', 'Pangolin',
  'Vulture', 'Owl', 'Woodpecker', 'Flamingo', 'Peacock', 'Humming', 'Kingfisher',
  'Orca', 'SpermWhale', 'Shark', 'Stingray', 'Sea Lion', 'Walrus', 'Dugong', 'Octopus',
  'Squid', 'Jellyfish', 'Tree Frog', 'Salamander', 'Dragon', 'Snake', 'Cobra', 'Beetle',
  'Firefly', 'Mantis', 'Koala', 'Hippo', 'Antelope', 'Reindeer', 'Yak', 'Meerkat',
  'Porcupine', 'Squirrel', 'Marmot', 'Opossum', 'Anteater', 'Armadillo', 'Alpaca',
  'Jaguar', 'SnowLeop', 'Hyena', 'Baboon', 'Gibbon', 'Monkey', 'Lemur', 'Pelican',
  'Seagull', 'Albatross', 'Crane', 'Magpie', 'Crow', 'Parrot', 'Sparrow', 'Swallow',
  'Cormorant', 'WhaleShark', 'Hammerhead', 'Electric', 'Clownfish', 'Seahorse',
  'Sailfish', 'Sunfish', 'FlyingFish', 'Crab', 'Lobster', 'Coral', 'Sea Urchin',
  'Cucumber', 'Crocodile', 'Iguana', 'Gecko', 'Toad', 'Dragonfly', 'Butterfly', 'Bee',
  'HoneyBadg', 'CloudLeop', 'Cougar', 'Brown Bear', 'Black Bear', 'Sun Bear', 'Muskox',
  'Gazelle', 'Serval', 'Caracal', 'Pallas Cat', 'Echidna', 'Wombat', 'Devil', 'Fox Bat',
  'Fruit Bat', 'Hamster', 'Guinea Pig', 'Capybara', 'Chinchilla', 'Sea Otter', 'Marten',
  'Weasel', 'Badger', 'Mongoose', 'Civet', 'Stork', 'Black Swan', 'Mute Swan', 'Duck',
  'Mallard', 'Myna', 'Thrush', 'Lark', 'Canary', 'Goshawk', 'Falcon', 'Emu', 'Ostrich',
  'Kiwi', 'Booby', 'Frigate', 'Manta Ray', 'Lionfish', 'Hagfish', 'Koi', 'Goldfish',
  'Betta', 'Aurora', 'Rainbow', 'Eclipse', 'MoonEclips', 'Lightning', 'Tornado',
  'Earthquake', 'Tsunami', 'Meteors', 'Tide', 'Mist', 'Hail', 'Blizzard', 'Sunset',
  'Sandstorm', 'Spout', 'Frost', 'Dew', 'Rime', 'Rain', 'Typhoon', 'Hurricane',
  'Drought', 'Thunder', 'Cold Wave', 'Heat Wave', 'Freezing', 'Snowmelt', 'Avalanche',
  'Landslide', 'Mudflow', 'Solar Halo', 'Lunar Halo', 'Sun Dog', 'GreenFlash',
  'SeaSparkle', 'Red Tide', 'Volcano', 'Lava Flow', 'Hot Spring', 'Geyser',
  'CloudStrik', 'Static', 'Swell', 'Whirlpool', 'Inversion', 'Foehn', 'Monsoon',
  'Front', 'Cyclone',
] as const;
