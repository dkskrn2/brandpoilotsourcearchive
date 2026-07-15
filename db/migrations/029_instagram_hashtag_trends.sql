begin;

create table content_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table content_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references content_categories(id),
  code text not null,
  name text not null,
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, code)
);

create table content_category_hashtags (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references content_categories(id),
  subcategory_id uuid null references content_subcategories(id),
  normalized_tag text not null,
  display_tag text not null,
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index content_category_hashtags_unique
  on content_category_hashtags (
    category_id,
    coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_tag
  );

alter table brand_profiles
  add column primary_category_id uuid null references content_categories(id);

create table brand_profile_subcategories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id) on delete cascade,
  brand_profile_id uuid not null references brand_profiles(id) on delete cascade,
  subcategory_id uuid null references content_subcategories(id),
  custom_name text null,
  custom_key text null,
  created_at timestamptz not null default now(),
  constraint brand_profile_subcategories_mode_check check (
    (subcategory_id is not null and custom_name is null and custom_key is null)
    or
    (subcategory_id is null and custom_name is not null and custom_key is not null)
  ),
  constraint brand_profile_subcategories_custom_name_check check (
    custom_name is null or char_length(btrim(custom_name)) between 1 and 30
  )
);

create unique index brand_profile_subcategories_system_unique
  on brand_profile_subcategories (brand_profile_id, subcategory_id)
  where subcategory_id is not null;
create unique index brand_profile_subcategories_custom_unique
  on brand_profile_subcategories (brand_profile_id, custom_key)
  where custom_key is not null;
create index brand_profile_subcategories_brand_idx
  on brand_profile_subcategories (brand_id);

create table instagram_trend_hashtags (
  id uuid primary key default gen_random_uuid(),
  normalized_tag text not null unique,
  display_tag text not null,
  meta_hashtag_id text null,
  last_refreshed_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table instagram_trend_media (
  id uuid primary key default gen_random_uuid(),
  instagram_media_id text not null unique,
  username text null,
  caption text null,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')),
  media_url text null,
  permalink text not null,
  posted_at timestamptz null,
  like_count bigint null check (like_count is null or like_count >= 0),
  comments_count bigint null check (comments_count is null or comments_count >= 0),
  last_fetched_at timestamptz not null,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_trend_media_raw_metadata_object_check
    check (jsonb_typeof(raw_metadata) = 'object')
);

create table instagram_trend_hashtag_media (
  hashtag_id uuid not null references instagram_trend_hashtags(id) on delete cascade,
  media_id uuid not null references instagram_trend_media(id) on delete cascade,
  meta_rank integer not null check (meta_rank between 1 and 50),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  primary key (hashtag_id, media_id),
  unique (hashtag_id, meta_rank)
);

create table brand_trend_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id) on delete cascade,
  hashtag_id uuid not null references instagram_trend_hashtags(id) on delete cascade,
  is_favorite boolean not null default false,
  last_searched_at timestamptz not null,
  search_count integer not null default 1 check (search_count > 0),
  unique (brand_id, hashtag_id)
);

create index brand_trend_searches_brand_searched_idx
  on brand_trend_searches (brand_id, last_searched_at desc);

create table instagram_trend_account_hashtags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id) on delete cascade,
  brand_channel_id uuid not null references brand_channels(id) on delete cascade,
  hashtag_id uuid not null references instagram_trend_hashtags(id) on delete cascade,
  quota_window_started_at timestamptz not null,
  last_meta_queried_at timestamptz not null,
  constraint instagram_trend_account_hashtags_channel_hashtag_unique
    unique (brand_channel_id, hashtag_id)
);

create index instagram_trend_account_hashtags_channel_quota_idx
  on instagram_trend_account_hashtags (brand_channel_id, quota_window_started_at);

create table brand_trend_saved_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id) on delete cascade,
  trend_media_id uuid not null references instagram_trend_media(id) on delete cascade,
  source_url_id uuid not null references source_urls(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (brand_id, trend_media_id),
  unique (source_url_id)
);

create index brand_trend_saved_media_brand_idx
  on brand_trend_saved_media (brand_id);

insert into content_categories (code, name, sort_order)
values
  ('travel_tourism', '여행·관광', 1),
  ('hospitality_leisure', '숙박·레저', 2),
  ('food_dining', '식음료·외식', 3),
  ('shopping_commerce', '쇼핑·커머스', 4),
  ('beauty_fashion', '뷰티·패션', 5),
  ('health_fitness', '건강·운동', 6),
  ('education_learning', '교육·학습', 7),
  ('parenting_family', '육아·가족', 8),
  ('pets', '반려동물', 9),
  ('real_estate_home', '부동산·주거', 10),
  ('finance_insurance', '금융·보험', 11),
  ('it_software', 'IT·소프트웨어', 12),
  ('business_professional', '비즈니스·전문 서비스', 13),
  ('culture_content', '문화·콘텐츠', 14),
  ('local_lifestyle', '지역·생활 서비스', 15);

insert into content_subcategories (category_id, code, name, sort_order)
select category.id, seed.code, seed.name, seed.sort_order
from (
  values
    ('travel_tourism', 'domestic_travel', '국내여행', 1),
    ('travel_tourism', 'international_travel', '해외여행', 2),
    ('travel_tourism', 'independent_travel', '자유여행', 3),
    ('travel_tourism', 'package_travel', '패키지여행', 4),
    ('travel_tourism', 'flights', '항공권', 5),
    ('travel_tourism', 'travel_budget', '여행 경비', 6),
    ('travel_tourism', 'local_guides', '지역 가이드', 7),
    ('hospitality_leisure', 'hotel', '호텔', 1),
    ('hospitality_leisure', 'pension', '펜션', 2),
    ('hospitality_leisure', 'resort', '리조트', 3),
    ('hospitality_leisure', 'camping', '캠핑', 4),
    ('hospitality_leisure', 'activities', '액티비티', 5),
    ('hospitality_leisure', 'theme_park', '테마파크', 6),
    ('hospitality_leisure', 'booking_service', '예약 서비스', 7),
    ('food_dining', 'restaurant', '음식점', 1),
    ('food_dining', 'cafe', '카페', 2),
    ('food_dining', 'bakery', '베이커리', 3),
    ('food_dining', 'alcohol', '주류', 4),
    ('food_dining', 'food_products', '식품', 5),
    ('food_dining', 'delivery', '배달', 6),
    ('food_dining', 'dining_brand', '외식 브랜드', 7),
    ('shopping_commerce', 'online_mall', '온라인 쇼핑몰', 1),
    ('shopping_commerce', 'retail', '리테일', 2),
    ('shopping_commerce', 'household_goods', '생활용품', 3),
    ('shopping_commerce', 'subscription_commerce', '구독 커머스', 4),
    ('shopping_commerce', 'international_purchase', '해외구매', 5),
    ('shopping_commerce', 'gifts', '선물', 6),
    ('shopping_commerce', 'product_curation', '상품 큐레이션', 7),
    ('beauty_fashion', 'skincare', '스킨케어', 1),
    ('beauty_fashion', 'makeup', '메이크업', 2),
    ('beauty_fashion', 'hair', '헤어', 3),
    ('beauty_fashion', 'nail', '네일', 4),
    ('beauty_fashion', 'apparel', '의류', 5),
    ('beauty_fashion', 'accessories', '잡화', 6),
    ('beauty_fashion', 'jewelry', '주얼리', 7),
    ('health_fitness', 'fitness', '헬스', 1),
    ('health_fitness', 'yoga', '요가', 2),
    ('health_fitness', 'pilates', '필라테스', 3),
    ('health_fitness', 'running', '러닝', 4),
    ('health_fitness', 'nutrition', '영양', 5),
    ('health_fitness', 'wellness', '웰니스', 6),
    ('health_fitness', 'medical_information', '의료 정보', 7),
    ('education_learning', 'entrance_exam', '입시', 1),
    ('education_learning', 'foreign_language', '외국어', 2),
    ('education_learning', 'professional_training', '직무 교육', 3),
    ('education_learning', 'certification', '자격증', 4),
    ('education_learning', 'online_course', '온라인 강의', 5),
    ('education_learning', 'early_childhood_education', '유아 교육', 6),
    ('education_learning', 'learning_coaching', '학습 코칭', 7),
    ('parenting_family', 'pregnancy_childbirth', '임신·출산', 1),
    ('parenting_family', 'infants_toddlers', '영유아', 2),
    ('parenting_family', 'elementary_parenting', '초등 육아', 3),
    ('parenting_family', 'family_activities', '가족 활동', 4),
    ('parenting_family', 'parenting_products', '육아용품', 5),
    ('parenting_family', 'parent_education', '부모 교육', 6),
    ('parenting_family', 'family_counseling', '가족 상담', 7),
    ('pets', 'dogs', '반려견', 1),
    ('pets', 'cats', '반려묘', 2),
    ('pets', 'pet_products', '반려용품', 3),
    ('pets', 'pet_food_treats', '사료·간식', 4),
    ('pets', 'training', '훈련', 5),
    ('pets', 'grooming', '미용', 6),
    ('pets', 'animal_health', '동물 건강', 7),
    ('real_estate_home', 'apartments', '아파트', 1),
    ('real_estate_home', 'commercial_property', '상가', 2),
    ('real_estate_home', 'rentals', '임대', 3),
    ('real_estate_home', 'property_sales', '분양', 4),
    ('real_estate_home', 'interior_design', '인테리어', 5),
    ('real_estate_home', 'remodeling', '리모델링', 6),
    ('real_estate_home', 'housing_information', '주거 정보', 7),
    ('finance_insurance', 'investment', '재테크', 1),
    ('finance_insurance', 'loans', '대출', 2),
    ('finance_insurance', 'cards', '카드', 3),
    ('finance_insurance', 'insurance', '보험', 4),
    ('finance_insurance', 'tax', '세금', 5),
    ('finance_insurance', 'accounting', '회계', 6),
    ('finance_insurance', 'asset_management', '자산 관리', 7),
    ('it_software', 'saas', 'SaaS', 1),
    ('it_software', 'ai', 'AI', 2),
    ('it_software', 'development', '개발', 3),
    ('it_software', 'data', '데이터', 4),
    ('it_software', 'security', '보안', 5),
    ('it_software', 'work_automation', '업무 자동화', 6),
    ('it_software', 'it_devices', 'IT 기기', 7),
    ('business_professional', 'marketing_consulting', '마케팅 컨설팅', 1),
    ('business_professional', 'brand_strategy', '브랜드 전략', 2),
    ('business_professional', 'content_operations', '콘텐츠 운영', 3),
    ('business_professional', 'legal', '법률', 4),
    ('business_professional', 'labor', '노무', 5),
    ('business_professional', 'tax', '세무', 6),
    ('business_professional', 'management_consulting', '경영 자문', 7),
    ('culture_content', 'books', '도서', 1),
    ('culture_content', 'movies', '영화', 2),
    ('culture_content', 'music', '음악', 3),
    ('culture_content', 'performances', '공연', 4),
    ('culture_content', 'exhibitions', '전시', 5),
    ('culture_content', 'creators', '크리에이터', 6),
    ('culture_content', 'media_production', '미디어 제작', 7),
    ('local_lifestyle', 'local_shops', '지역 상점', 1),
    ('local_lifestyle', 'cleaning', '청소', 2),
    ('local_lifestyle', 'moving', '이사', 3),
    ('local_lifestyle', 'repair', '수리', 4),
    ('local_lifestyle', 'laundry', '세탁', 5),
    ('local_lifestyle', 'wedding', '웨딩', 6),
    ('local_lifestyle', 'daily_convenience', '생활 편의', 7)
) as seed(category_code, code, name, sort_order)
join content_categories category on category.code = seed.category_code;

insert into content_category_hashtags (
  category_id,
  normalized_tag,
  display_tag,
  sort_order
)
select category.id, seed.normalized_tag, seed.display_tag, seed.sort_order
from (
  values
    ('travel_tourism', '여행', '여행', 1),
    ('travel_tourism', '국내여행', '국내여행', 2),
    ('travel_tourism', '해외여행', '해외여행', 3),
    ('hospitality_leisure', '호텔', '호텔', 1),
    ('hospitality_leisure', '호캉스', '호캉스', 2),
    ('hospitality_leisure', '여행숙소', '여행숙소', 3),
    ('food_dining', '맛집', '맛집', 1),
    ('food_dining', '카페', '카페', 2),
    ('food_dining', '먹스타그램', '먹스타그램', 3),
    ('shopping_commerce', '쇼핑', '쇼핑', 1),
    ('shopping_commerce', '온라인쇼핑', '온라인쇼핑', 2),
    ('shopping_commerce', '신상품', '신상품', 3),
    ('beauty_fashion', '뷰티', '뷰티', 1),
    ('beauty_fashion', '패션', '패션', 2),
    ('beauty_fashion', '데일리룩', '데일리룩', 3),
    ('health_fitness', '운동', '운동', 1),
    ('health_fitness', '헬스', '헬스', 2),
    ('health_fitness', '건강', '건강', 3),
    ('education_learning', '교육', '교육', 1),
    ('education_learning', '공부', '공부', 2),
    ('education_learning', '자기계발', '자기계발', 3),
    ('parenting_family', '육아', '육아', 1),
    ('parenting_family', '육아정보', '육아정보', 2),
    ('parenting_family', '가족', '가족', 3),
    ('pets', '반려동물', '반려동물', 1),
    ('pets', '강아지', '강아지', 2),
    ('pets', '고양이', '고양이', 3),
    ('real_estate_home', '부동산', '부동산', 1),
    ('real_estate_home', '인테리어', '인테리어', 2),
    ('real_estate_home', '아파트', '아파트', 3),
    ('finance_insurance', '재테크', '재테크', 1),
    ('finance_insurance', '금융', '금융', 2),
    ('finance_insurance', '보험', '보험', 3),
    ('it_software', 'it', 'IT', 1),
    ('it_software', 'ai', 'AI', 2),
    ('it_software', 'saas', 'SaaS', 3),
    ('business_professional', '마케팅', '마케팅', 1),
    ('business_professional', '브랜딩', '브랜딩', 2),
    ('business_professional', '사업', '사업', 3),
    ('culture_content', '문화생활', '문화생활', 1),
    ('culture_content', '콘텐츠', '콘텐츠', 2),
    ('culture_content', '전시', '전시', 3),
    ('local_lifestyle', '지역맛집', '지역맛집', 1),
    ('local_lifestyle', '동네생활', '동네생활', 2),
    ('local_lifestyle', '생활서비스', '생활서비스', 3)
) as seed(category_code, normalized_tag, display_tag, sort_order)
join content_categories category on category.code = seed.category_code;

with legacy_mapping(legacy_value, category_code) as (
  values
    ('travel_tourism', 'travel_tourism'),
    ('여행·관광', 'travel_tourism'),
    ('hospitality_leisure', 'hospitality_leisure'),
    ('숙박·레저', 'hospitality_leisure'),
    ('food_dining', 'food_dining'),
    ('식음료·외식', 'food_dining'),
    ('shopping_commerce', 'shopping_commerce'),
    ('쇼핑·커머스', 'shopping_commerce'),
    ('도매 및 소매업', 'shopping_commerce'),
    ('beauty_fashion', 'beauty_fashion'),
    ('뷰티·패션', 'beauty_fashion'),
    ('health_fitness', 'health_fitness'),
    ('건강·운동', 'health_fitness'),
    ('education_learning', 'education_learning'),
    ('교육·학습', 'education_learning'),
    ('교육 서비스업', 'education_learning'),
    ('parenting_family', 'parenting_family'),
    ('육아·가족', 'parenting_family'),
    ('pets', 'pets'),
    ('반려동물', 'pets'),
    ('real_estate_home', 'real_estate_home'),
    ('부동산·주거', 'real_estate_home'),
    ('부동산업', 'real_estate_home'),
    ('finance_insurance', 'finance_insurance'),
    ('금융·보험', 'finance_insurance'),
    ('금융 및 보험업', 'finance_insurance'),
    ('it_software', 'it_software'),
    ('IT·소프트웨어', 'it_software'),
    ('business_professional', 'business_professional'),
    ('비즈니스·전문 서비스', 'business_professional'),
    ('culture_content', 'culture_content'),
    ('문화·콘텐츠', 'culture_content'),
    ('local_lifestyle', 'local_lifestyle'),
    ('지역·생활 서비스', 'local_lifestyle')
)
update brand_profiles profile
set primary_category_id = category.id
from legacy_mapping mapping
join content_categories category on category.code = mapping.category_code
where profile.primary_category_id is null
  and profile.industry = mapping.legacy_value;

create trigger content_categories_set_updated_at
before update on content_categories
for each row execute function set_updated_at();

create trigger content_subcategories_set_updated_at
before update on content_subcategories
for each row execute function set_updated_at();

create trigger instagram_trend_hashtags_set_updated_at
before update on instagram_trend_hashtags
for each row execute function set_updated_at();

create trigger instagram_trend_media_set_updated_at
before update on instagram_trend_media
for each row execute function set_updated_at();

commit;
